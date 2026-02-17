import { defineStore } from 'pinia';
import { ref, computed, shallowRef, watch } from 'vue';
import { useHistoryStore } from './history';
import { useToastStore } from './toast';
import { apiFetch, API_BASE } from '../utils/api';

const API_KEY = import.meta.env.VITE_API_KEY || '';
const STORAGE_KEY = 'protoScale_process';
const TEXTURE_INFO_KEY = 'protoScale_texture_info';
const GLOBAL_POLLING_KEY = '__protoScale_polling_interval__';

const STAGE_ORDER = ['rembg', 'geometry', 'postprocess', 'completed'];
const MIN_STAGE_MS = 1200;

// AI Model presets (Meshy AI Models)
const MODEL_PRESETS = {
  v1: {
    label: 'ProtoScale-v1',
    description: 'Meshy 4 - Fast generation',
    value: 'v1',
    aiModel: 'meshy-4',
    estimatedTime: '1-2 min',
    quality: 'Standard',
    recommended: false,
    creditsGeometry: 5,
    creditsTexture: 10,
    creditsTotal: 15,
  },
  v2: {
    label: 'ProtoScale-v2',
    description: 'Meshy 5 - Balanced quality',
    value: 'v2',
    aiModel: 'meshy-5',
    estimatedTime: '2-3 min',
    quality: 'High',
    recommended: true,
    creditsGeometry: 5,
    creditsTexture: 10,
    creditsTotal: 15,
  },
  v3: {
    label: 'ProtoScale-v3',
    description: 'Latest (Meshy 6) - Best quality',
    value: 'v3',
    aiModel: 'latest',
    estimatedTime: '2-3 min',
    quality: 'Premium',
    recommended: false,
    creditsGeometry: 20,
    creditsTexture: 10,
    creditsTotal: 30,
  }
};

export const useProcessStore = defineStore('process', () => {
  // --- State ---
  const steps = ['Upload', 'Generate', 'Preview', 'Export'];
  const currentStepIndex = ref(0);
  const isProcessing = ref(false);
  const isGenerateConfigLocked = ref(false);
  const pendingGenerateSettings = ref(null);
  const isRetexturing = computed(() => ['processing', 'cancelling'].includes(retextureStatus.value));
  const progress = ref(0);
  const error = ref(null);
  const stage = ref(null);
  const jobStartedAt = ref(null); // ms timestamp; used for ETA/elapsed + persistence across refresh
  // UI stage is what we *display* (with latch + synthesized intermediate stages).
  const uiStage = ref(null);
  const uiStageSince = ref(0); // ms timestamp
  const uiStageQueue = ref([]); // array of stage strings (not persisted)
  const uploadedImages = ref([]);
  const uploadedImage = computed({
    get: () => uploadedImages.value.length > 0 ? uploadedImages.value[0] : null,
    set: (val) => {
      if (val) {
        uploadedImages.value = [val];
      } else {
        uploadedImages.value = [];
      }
    }
  });
  const selectedPreset = ref('v2');
  const activeJobQualityPreset = ref(null);
  const enableTexture = ref(false);
  const jobStatus = ref(null); // idle, uploading, ready, processing, completed, failed

  const jobId = ref(null);
  const modelUrl = ref(null);
  const analysisData = ref(null);
  const userScale = ref({ x: 1, y: 1, z: 1 });
  const bboxSize = ref({ x: 0, y: 0, z: 0 });
  const modelScene = shallowRef(null);
  const isSimulationOpen = ref(false);
  const simulationStlFile = ref(null);

  // Retexture state
  const retextureStatus = ref('idle'); // idle | processing | cancelling | completed | failed
  const retextureProgress = ref(0);
  const retextureError = ref(null);
  const textureSettings = ref({
    objectPrompt: '',
    stylePrompt: '',
    enablePbr: true,
    negativePrompt: '',
    artStyle: 'realistic',
    resolution: 2048,
    aiModel: 'meshy-6-preview'
  });
  const lastRetextureRequest = ref(null);
  const retextureStartedAt = ref(null); // ms timestamp for ETA calculation

  // Background operation tracking (single source of truth for any background job)
  const backgroundOperation = ref({
    type: null,        // 'generate' | 'texture' | null
    jobId: null,       // Job ID being processed
    progress: 0,       // 0-100
    status: null,      // Job status
    stage: null,       // Current stage (for generate)
    startedAt: null    // Timestamp for ETA calculation
  });

  // Guard to prevent concurrent operations
  const hasActiveOperation = computed(() =>
    isProcessing.value ||
    isRetexturing.value ||
    backgroundOperation.value.type !== null
  );

  // --- Texture ETA Helpers ---
  const TEXTURE_DURATION_KEY = 'protoScale_texture_durations';

  /**
   * Read stored actual durations from localStorage.
   * Keyed by a settings fingerprint so different settings have independent history.
   */
  function _readDurationHistory() {
    try { return JSON.parse(localStorage.getItem(TEXTURE_DURATION_KEY) || '{}'); } catch { return {}; }
  }

  function _settingsFingerprint(settings) {
    return `${settings.resolution}_${settings.numViews}_${settings.applyPaint ? 1 : 0}`;
  }

  function _recordActualDuration(settings, durationSeconds) {
    const history = _readDurationHistory();
    const key = _settingsFingerprint(settings);
    if (!history[key]) history[key] = [];
    history[key].push(Math.round(durationSeconds));
    // Keep only the last 5 measurements per settings combo
    if (history[key].length > 5) history[key] = history[key].slice(-5);
    try { localStorage.setItem(TEXTURE_DURATION_KEY, JSON.stringify(history)); } catch {}
  }

  function _getHistoricalAverage(settings) {
    const history = _readDurationHistory();
    const key = _settingsFingerprint(settings);
    const durations = history[key];
    if (!durations || durations.length === 0) return null;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }

  function estimateTextureEtaSeconds(settings) {
    // Use historical average if available (most accurate)
    const historical = _getHistoricalAverage(settings);
    if (historical) return historical;

    // Fallback: formula-based estimate with conservative base
    const baseSeconds = 150;
    const resolutionFactorMap = { 512: 0.6, 768: 0.8, 1024: 1.0, 1280: 1.25, 1536: 1.5, 2048: 2.0 };
    const resolutionFactor = resolutionFactorMap[settings.resolution] || 1.0;
    const viewsFactor = settings.numViews / 4;
    const paintFactor = settings.applyPaint ? 1.0 : 0.85;
    return Math.max(60, Math.round(baseSeconds * resolutionFactor * viewsFactor * paintFactor));
  }

  function formatDurationShort(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes === 0) return `${remainder}s`;
    if (remainder === 0) return `${minutes}m`;
    return `${minutes}m ${remainder}s`;
  }

  function getTextureEtaRemaining() {
    const settings = lastRetextureRequest.value || textureSettings.value;
    const totalEta = estimateTextureEtaSeconds(settings);
    const startedAt = retextureStartedAt.value || backgroundOperation.value.startedAt;
    if (!startedAt) return `~${formatDurationShort(totalEta)}`;
    const elapsed = (Date.now() - startedAt) / 1000;
    const remaining = Math.max(0, totalEta - elapsed);
    if (remaining <= 0) return 'Almost done...';
    return `~${formatDurationShort(remaining)} remaining`;
  }

  // Polling
  let pollingInterval = null;
  let retexturePollingInterval = null;
  let pollingJobId = null;
  let pollingToken = 0;
  let completionHandledForJobId = null;
  let uiStageTimer = null;

  // Initialize from storage
  loadFromStorage();

  // Watch for changes to persist state
  let _suppressStorageSync = false;
  watch(
    [currentStepIndex, jobId, uploadedImages, modelUrl, selectedPreset, activeJobQualityPreset, jobStatus, progress, stage, jobStartedAt, uiStage, uiStageSince, retextureStatus, retextureProgress, retextureStartedAt, backgroundOperation, isGenerateConfigLocked, pendingGenerateSettings],
    () => {
      saveToStorage();
    },
    { deep: true }
  );

  // --- Multi-tab sync via storage event ---
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;

      let data;
      try { data = JSON.parse(e.newValue); } catch { return; }

      _suppressStorageSync = true;

      // Sync background operation state (most critical for multi-tab)
      if (data.backgroundOperation) {
        backgroundOperation.value = data.backgroundOperation;

        // If another tab started a background job and this tab isn't polling, start polling
        if (data.backgroundOperation.type === 'generate' && data.backgroundOperation.jobId) {
          if (!pollingInterval || pollingJobId !== data.backgroundOperation.jobId) {
            startPolling(data.backgroundOperation.jobId);
          }
        } else if (data.backgroundOperation.type === 'texture' && data.backgroundOperation.jobId) {
          if (!retexturePollingInterval) {
            jobId.value = data.backgroundOperation.jobId;
            startRetexturePolling();
          }
        }

        // If another tab cleared the background op (job completed), stop polling here too
        if (!data.backgroundOperation.type) {
          // Background job was cleared — update local state
          if (pollingInterval && pollingJobId && pollingJobId !== jobId.value) {
            stopPolling();
          }
        }
      }

      // Sync job progress fields (so all tabs show up-to-date progress)
      if (data.jobStatus !== undefined) jobStatus.value = data.jobStatus;
      if (data.progress !== undefined) progress.value = data.progress;
      if (data.stage !== undefined) stage.value = data.stage;
      if (data.jobStartedAt !== undefined) jobStartedAt.value = data.jobStartedAt;
      if (data.isGenerateConfigLocked !== undefined) isGenerateConfigLocked.value = data.isGenerateConfigLocked;
      if (data.pendingGenerateSettings !== undefined) pendingGenerateSettings.value = data.pendingGenerateSettings;
      // Don't let another tab overwrite retextureStatus if we're actively polling
      // (another tab navigating to a different model resets its retextureStatus to 'idle',
      // which would corrupt our in-progress state)
      if (data.retextureStatus !== undefined && !retexturePollingInterval) {
        retextureStatus.value = data.retextureStatus;
      }
      if (data.retextureProgress !== undefined && !retexturePollingInterval) {
        retextureProgress.value = data.retextureProgress;
      }

      // Sync jobId — but DON'T sync currentStepIndex, uploadedImage, modelUrl
      // Each tab can be on a different page viewing different models
      if (data.jobId !== undefined && !jobId.value) {
        jobId.value = data.jobId;
      }

      _suppressStorageSync = false;
    });
  }

  // --- Getters ---
  const currentStep = computed(() => steps[currentStepIndex.value]);

  // --- Persistence Helpers ---
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.jobId) jobId.value = data.jobId;
        if (data.currentStepIndex !== undefined) currentStepIndex.value = data.currentStepIndex;
        if (data.isGenerateConfigLocked !== undefined) isGenerateConfigLocked.value = data.isGenerateConfigLocked;
        if (data.pendingGenerateSettings !== undefined) pendingGenerateSettings.value = data.pendingGenerateSettings;
        // Migration: old data has uploadedImage (string), new has uploadedImages (array)
        if (data.uploadedImages && Array.isArray(data.uploadedImages)) {
          uploadedImages.value = data.uploadedImages;
        } else if (data.uploadedImage) {
          uploadedImages.value = [data.uploadedImage];
        }
        if (data.modelUrl) modelUrl.value = data.modelUrl;
        if (data.selectedPreset) selectedPreset.value = data.selectedPreset;
        if (data.activeJobQualityPreset !== undefined) activeJobQualityPreset.value = data.activeJobQualityPreset;
        if (data.jobStatus) jobStatus.value = data.jobStatus;
        if (data.progress !== undefined) progress.value = data.progress;
        if (data.stage !== undefined) stage.value = data.stage;
        if (data.jobStartedAt !== undefined) jobStartedAt.value = data.jobStartedAt;
        if (data.uiStage !== undefined) uiStage.value = data.uiStage;
        if (data.uiStageSince !== undefined) uiStageSince.value = data.uiStageSince;
        if (data.retextureStatus !== undefined) retextureStatus.value = data.retextureStatus;
        if (data.retextureProgress !== undefined) retextureProgress.value = data.retextureProgress;
        if (data.retextureStartedAt !== undefined) retextureStartedAt.value = data.retextureStartedAt;
        if (!activeJobQualityPreset.value && selectedPreset.value) {
          activeJobQualityPreset.value = selectedPreset.value;
        }

        // Restore background operation if it exists
        if (data.backgroundOperation && data.backgroundOperation.type) {
          backgroundOperation.value = data.backgroundOperation;

          // Resume polling for background job
          if (backgroundOperation.value.type === 'generate') {
            console.log('[loadFromStorage] Resuming background generate polling');
            startPolling(backgroundOperation.value.jobId);
          } else if (backgroundOperation.value.type === 'texture') {
            console.log('[loadFromStorage] Resuming background texture polling');
            jobId.value = backgroundOperation.value.jobId;
            startRetexturePolling();
          }

          // Add to history display
          const historyStore = useHistoryStore();
          historyStore.addInProgressJob(backgroundOperation.value);
        }
      }
    } catch (e) {
      console.error('Failed to load process state:', e);
    }
  }

  function saveToStorage() {
    // Prevent echo loop: don't write back state that was just synced from another tab
    if (_suppressStorageSync) return;
    try {
      const data = {
        jobId: jobId.value,
        currentStepIndex: currentStepIndex.value,
        uploadedImages: uploadedImages.value,
        modelUrl: modelUrl.value,
        selectedPreset: selectedPreset.value,
        activeJobQualityPreset: activeJobQualityPreset.value,
        jobStatus: jobStatus.value,
        progress: progress.value,
        stage: stage.value,
        jobStartedAt: jobStartedAt.value,
        uiStage: uiStage.value,
        uiStageSince: uiStageSince.value,
        retextureStatus: retextureStatus.value,
        retextureProgress: retextureProgress.value,
        retextureStartedAt: retextureStartedAt.value,
        isGenerateConfigLocked: isGenerateConfigLocked.value,
        pendingGenerateSettings: pendingGenerateSettings.value,
        backgroundOperation: backgroundOperation.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save process state:', e);
    }
  }

  function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function readTextureInfoMap() {
    try {
      const raw = localStorage.getItem(TEXTURE_INFO_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.error('Failed to read texture info map:', e);
      return {};
    }
  }

  function writeTextureInfoMap(map) {
    try {
      localStorage.setItem(TEXTURE_INFO_KEY, JSON.stringify(map));
    } catch (e) {
      console.error('Failed to write texture info map:', e);
    }
  }

  function getJobTextureInfo(id = jobId.value) {
    if (!id) return { textureApplied: false, paintApplied: false, updatedAt: null };
    const map = readTextureInfoMap();
    const info = map[id];
    if (!info) return { textureApplied: false, paintApplied: false, updatedAt: null };
    return {
      textureApplied: !!info.textureApplied,
      paintApplied: !!info.paintApplied,
      updatedAt: info.updatedAt || null,
    };
  }

  function setJobTextureInfo(id = jobId.value, info = {}) {
    if (!id) return { textureApplied: false, paintApplied: false, updatedAt: null };
    const map = readTextureInfoMap();
    const prev = map[id] || {};
    map[id] = {
      textureApplied: info.textureApplied ?? !!prev.textureApplied,
      paintApplied: info.paintApplied ?? !!prev.paintApplied,
      updatedAt: Date.now(),
    };
    writeTextureInfoMap(map);
    return map[id];
  }

  function stageIndex(s) {
    return STAGE_ORDER.indexOf(s);
  }

  function normalizeStage(s) {
    if (!s) return null;
    return STAGE_ORDER.includes(s) ? s : null;
  }

  function clearUiStageTimer() {
    if (uiStageTimer) {
      clearTimeout(uiStageTimer);
      uiStageTimer = null;
    }
  }

  function setUiStage(nextStage) {
    uiStage.value = nextStage;
    uiStageSince.value = Date.now();
    clearUiStageTimer();
  }

  function attemptAdvanceUiStage() {
    if (!uiStageQueue.value.length) {
      clearUiStageTimer();
      return;
    }

    const now = Date.now();
    const current = normalizeStage(uiStage.value);
    const since = uiStageSince.value || 0;
    const elapsed = current ? (now - since) : MIN_STAGE_MS;

    if (!current || elapsed >= MIN_STAGE_MS) {
      const next = uiStageQueue.value.shift();
      setUiStage(next);
      // Keep draining until queue is empty, but respect latch for each stage.
      uiStageTimer = setTimeout(attemptAdvanceUiStage, MIN_STAGE_MS);
      return;
    }

    const remaining = Math.max(0, MIN_STAGE_MS - elapsed);
    clearUiStageTimer();
    uiStageTimer = setTimeout(attemptAdvanceUiStage, remaining);
  }

  function enqueueUiStagesToTarget(targetStageRaw) {
    const targetStage = normalizeStage(targetStageRaw);
    if (!targetStage) return;

    const current = normalizeStage(uiStage.value);
    const currentIdx = current ? stageIndex(current) : -1;
    const targetIdx = stageIndex(targetStage);
    if (targetIdx < 0) return;

    // If UI stage hasn't been set yet, start from the first meaningful stage.
    if (currentIdx === -1) {
      // If we missed early stages due to polling timing, synthesize from the start.
      for (let i = 0; i <= targetIdx; i++) {
        uiStageQueue.value.push(STAGE_ORDER[i]);
      }
      attemptAdvanceUiStage();
      return;
    }

    if (targetIdx <= currentIdx) {
      return;
    }

    for (let i = currentIdx + 1; i <= targetIdx; i++) {
      const s = STAGE_ORDER[i];
      if (!uiStageQueue.value.length || uiStageQueue.value[uiStageQueue.value.length - 1] !== s) {
        uiStageQueue.value.push(s);
      }
    }

    attemptAdvanceUiStage();
  }

  function computeCompletionDelayMs() {
    const now = Date.now();
    const current = normalizeStage(uiStage.value);
    const since = uiStageSince.value || 0;
    const remainingCurrent = current ? Math.max(0, MIN_STAGE_MS - (now - since)) : 0;
    const queued = uiStageQueue.value.length;
    // Allow UI to show queued stages (incl. completed) before navigating.
    const total = remainingCurrent + (queued * MIN_STAGE_MS) + 50;
    return Math.min(6000, Math.max(1200, total));
  }

  function applyBackendUpdate({ stage: nextStage, status: nextStatus, progress: nextProgress, error: nextError }) {
    // Keep raw backend values too (useful for debugging/export).
    stage.value = nextStage || null;
    if (nextProgress !== undefined && nextProgress !== null) progress.value = nextProgress;
    if (nextStatus) jobStatus.value = nextStatus;
    if (nextError !== undefined) error.value = nextError;

    // UI stage: synthesize and latch to make stages visible even if polling skips them.
    if (nextStage) {
      // If backend reports texture but preset skips it, treat it as postprocess.
      const effectiveTarget = (nextStage === 'texture' && shouldSkipTextureStage()) ? 'postprocess' : nextStage;
      enqueueUiStagesToTarget(effectiveTarget);
    }
  }

  async function syncStatus(id) {
    if (!id) return;

    try {
      const res = await apiFetch(`/api/jobs/${id}/status`);
      if (!res.ok) {
        if (res.status === 404) {
          // Job not found - likely lost due to backend restart
          console.warn(`[syncStatus] Job ${id} not found (404)`);
          stopPolling();
          isProcessing.value = false;
          error.value = 'Job session was lost. This can happen if the backend was restarted. Please try generating again.';
          jobStatus.value = 'failed';
        } else {
          console.warn(`[syncStatus] Status check failed: ${res.status}`);
        }
        return;
      }
      const data = await res.json();
      applyBackendUpdate({
        stage: data.stage || null,
        status: data.status ?? jobStatus.value,
        progress: data.progress ?? progress.value ?? 0,
        error: data.error
      });

      if (data.status === 'failed') {
        error.value = data.error || 'Job failed';
        isProcessing.value = false;
        stopPolling();
      }

      if (data.status === 'completed' || (data.stage === 'completed' && (data.progress ?? 0) >= 100)) {
        progress.value = 100;
        stage.value = data.stage || 'completed';
        jobStatus.value = 'completed';
        stopPolling();
        // Ensure UI shows any missing stages before navigating.
        enqueueUiStagesToTarget('completed');
        handleJobCompletion(id, { delayMs: computeCompletionDelayMs() });
      }
    } catch (e) {
      console.warn('[syncStatus] Error:', e);
    }
  }

  // --- Polling Functions ---
  function startPolling(id) {
    if (!id) return;

    // If we're already polling the same job id, do nothing.
    if (pollingInterval && pollingJobId === id) {
      console.log('[Polling] Already polling same job, skipping duplicate');
      return;
    }

    // If switching jobs (or recovering from HMR / stale interval), always reset first.
    stopPolling();

    console.log(`[Polling] Starting polling for job ${id}`);
    let displayProgress = progress.value;
    pollingJobId = id;
    const token = ++pollingToken;

    const pollOnce = async () => {
      // If a newer polling session started, kill this one.
      if (token !== pollingToken) {
        return;
      }

      try {
        const res = await apiFetch(`/api/jobs/${id}/status`);
        if (!res.ok) {
          if (res.status === 404) {
            // Job not found - stop polling and show error
            console.warn(`[Polling] Job ${id} not found (404)`);
            stopPolling();
            isProcessing.value = false;
            error.value = 'Job session was lost. This can happen if the backend was restarted. Please try generating again.';
            jobStatus.value = 'failed';

            // Clear background operation if this was a background job
            if (backgroundOperation.value.type === 'generate' && backgroundOperation.value.jobId === id) {
              backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };
            }
          } else {
            console.warn(`[Polling] Status check failed: ${res.status}`);
          }
          return;
        }
        const data = await res.json();

        // Check if this is a background generate job
        const isBackgroundGenerate = backgroundOperation.value.type === 'generate' &&
                                     backgroundOperation.value.jobId === id;

        // Smooth progress interpolation
        const target = data.progress || 0;
        if (target > displayProgress) {
          displayProgress = Math.min(target, displayProgress + Math.max(2, (target - displayProgress) * 0.3));
        }

        if (isBackgroundGenerate) {
          // Update background state
          backgroundOperation.value.progress = Math.round(displayProgress);
          backgroundOperation.value.status = data.status;
          backgroundOperation.value.stage = data.stage;

          // Update history card
          const historyStore = useHistoryStore();
          historyStore.updateInProgressJob(id, {
            progress: Math.round(displayProgress),
            stage: data.stage
          });
        } else {
          // Normal foreground update
          applyBackendUpdate({
            stage: data.stage || null,
            status: data.status,
            progress: Math.round(displayProgress),
            error: data.error
          });
        }

        console.log(`[Polling] Progress: ${Math.round(displayProgress)}%, Stage: ${data.stage}, Status: ${data.status}, Background: ${isBackgroundGenerate}`);

        if (data.status === 'completed' || (data.stage === 'completed' && (data.progress ?? 0) >= 100)) {
          stopPolling();

          if (isBackgroundGenerate) {
            handleBackgroundJobCompletion(id, 'generate');
          } else {
            progress.value = 100;
            stage.value = data.stage || 'completed';
            jobStatus.value = 'completed';
            enqueueUiStagesToTarget('completed');
            handleJobCompletion(id, { delayMs: computeCompletionDelayMs() });
          }
        } else if (data.status === 'failed') {
          stopPolling();

          if (isBackgroundGenerate) {
            backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };
            const historyStore = useHistoryStore();
            historyStore.markJobCompleted(id);
          } else {
            error.value = data.error || 'Job failed';
            isProcessing.value = false;
          }
        }
      } catch (e) {
        console.warn('[Polling] Error:', e);
        // Continue polling on transient errors
      }
    };

    // Do an immediate tick so UI doesn't wait 2s before the first update.
    pollOnce();

    pollingInterval = setInterval(pollOnce, 2000);
    if (typeof window !== 'undefined') {
      window[GLOBAL_POLLING_KEY] = pollingInterval;
    }
  }

  function stopPolling() {
    // Best-effort: in dev/HMR, the store module can be reloaded while an older
    // interval is still running. Track the interval on window so we can stop it.
    if (typeof window !== 'undefined' && window[GLOBAL_POLLING_KEY]) {
      clearInterval(window[GLOBAL_POLLING_KEY]);
      window[GLOBAL_POLLING_KEY] = null;
    }
    if (pollingInterval) {
      console.log('[Polling] Stopping polling');
      clearInterval(pollingInterval);
      pollingInterval = null;
      pollingJobId = null;
    }
  }

  // --- Actions ---

  function normalizeGenerateSettings(options = {}) {
    const modelType = options.modelType === 'lowpoly' ? 'lowpoly' : 'standard';
    let modelPreset = options.modelPreset && MODEL_PRESETS[options.modelPreset]
      ? options.modelPreset
      : (selectedPreset.value && MODEL_PRESETS[selectedPreset.value] ? selectedPreset.value : 'v2');
    if (modelType === 'lowpoly') {
      modelPreset = 'v3';
    }

    return {
      removeBackground: options.removeBackground !== undefined ? !!options.removeBackground : true,
      modelPreset,
      enablePbr: options.enablePbr !== undefined ? !!options.enablePbr : true,
      modelType,
      symmetryMode: ['off', 'auto', 'on'].includes(options.symmetryMode) ? options.symmetryMode : 'auto',
    };
  }

  function buildGenerateRequestBody(settings) {
    const normalized = normalizeGenerateSettings(settings || {});
    const selectedModel = MODEL_PRESETS[normalized.modelPreset] || MODEL_PRESETS.v2;

    return {
      remove_bg: normalized.removeBackground,
      ai_model: selectedModel.aiModel,
      should_texture: normalized.enablePbr,
      enable_pbr: normalized.enablePbr,
      model_type: normalized.modelType,
      symmetry_mode: normalized.symmetryMode,
    };
  }

  // 1. Upload only — show preview, wait for user to click Generate
  async function uploadImage(filesOrFile, options = {}) {
    // Check if another operation is running
    const canStart = canStartNewJob();
    if (!canStart.allowed) {
      console.warn('[uploadImage] Blocked:', canStart.reason);
      error.value = canStart.reason;
      return;
    }

    // Normalize: accept single File or array of Files
    const fileArray = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];

    isProcessing.value = true;
    error.value = null;
    jobStatus.value = 'uploading';

    try {
      uploadedImages.value = fileArray.map(f => URL.createObjectURL(f));
      selectedPreset.value = options.modelPreset ?? 'v2';
      activeJobQualityPreset.value = options.modelPreset ?? 'v2';
      enableTexture.value = options.enableTexture ?? false;
      pendingGenerateSettings.value = normalizeGenerateSettings(options);

      const selectedModel = MODEL_PRESETS[options.modelPreset ?? 'v2'];
      const formData = new FormData();
      fileArray.forEach(f => formData.append('files', f));
      formData.append('remove_bg', options.removeBackground ?? true);
      formData.append('ai_model', selectedModel.aiModel);
      formData.append('should_texture', options.enablePbr ?? true);
      formData.append('enable_pbr', options.enablePbr ?? true);
      if (options.modelType) formData.append('model_type', options.modelType);
      if (options.symmetryMode) formData.append('symmetry_mode', options.symmetryMode);

      const res = await apiFetch(`/api/upload`, {
        method: 'POST',
        headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
        body: formData,
      });

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json();
      jobId.value = data.job_id;
      setJobTextureInfo(jobId.value, { textureApplied: false, paintApplied: false });
      lastRetextureRequest.value = null;
      jobStatus.value = data.status || 'pending';
      stage.value = 'ready';
      uiStage.value = 'ready';
      uiStageSince.value = Date.now();
      uiStageQueue.value = [];
      clearUiStageTimer();

      isProcessing.value = false;
    } catch (e) {
      error.value = e.message;
      jobStatus.value = 'failed';
      isProcessing.value = false;
    }
  }

  // 2. Navigate to progress view and trigger 3D generation
  async function generate3D() {
    // Guard: Don't start if already processing or no job
    if (!jobId.value || isProcessing.value) {
      console.log('[generate3D] Skipped - no jobId or already processing');
      return;
    }

    // Check if another operation is running
    const canStart = canStartNewJob();
    if (!canStart.allowed) {
      console.warn('[generate3D] Blocked:', canStart.reason);
      error.value = canStart.reason;
      return;
    }

    isProcessing.value = true;
    error.value = null;
    progress.value = 0;
    stage.value = null;
    uiStage.value = null;
    uiStageSince.value = 0;
    uiStageQueue.value = [];
    clearUiStageTimer();
    jobStartedAt.value = Date.now();
    jobStatus.value = 'processing';

    try {
      console.log(`[generate3D] Starting generation for job ${jobId.value}`);

      const generateConfig = pendingGenerateSettings.value
        ? normalizeGenerateSettings(pendingGenerateSettings.value)
        : null;
      const requestBody = generateConfig ? buildGenerateRequestBody(generateConfig) : null;
      if (generateConfig) {
        selectedPreset.value = generateConfig.modelPreset;
        activeJobQualityPreset.value = generateConfig.modelPreset;
      }

      const res = await apiFetch(`/api/jobs/${jobId.value}/generate-3d`, {
        method: 'POST',
        headers: {
          ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
          ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
        },
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
      });

      console.log(`[generate3D] POST response: ${res.status}`);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error(`[generate3D] Failed to start:`, errorData);
        throw new Error(errorData.detail || `Failed to start generation: ${res.status}`);
      }

      // Start polling for progress
      startPolling(jobId.value);

    } catch (e) {
      error.value = e.message;
      jobStatus.value = 'failed';
      isProcessing.value = false;
      stage.value = null;
    }
  }

  // Resume polling for existing job (e.g., after page refresh or navigation)
  function resumeJob() {
    if (!jobId.value) {
      console.log('[resumeJob] No jobId to resume');
      return;
    }

    // If already completed, navigate to preview
    if (jobStatus.value === 'completed') {
      console.log('[resumeJob] Job already completed, navigating to preview');
      currentStepIndex.value = 2;
      return;
    }

    // If processing, start polling
    if (jobStatus.value === 'processing' || jobStatus.value === 'queued') {
      console.log(`[resumeJob] Resuming job ${jobId.value} with status ${jobStatus.value}`);
      isProcessing.value = true;
      startPolling(jobId.value);
    }
  }

  // Handle successful job completion
  function handleJobCompletion(id, { delayMs = 1200 } = {}) {
    const jobIdToUse = id || jobId.value;
    if (completionHandledForJobId === jobIdToUse) {
      return;
    }
    completionHandledForJobId = jobIdToUse;

    modelUrl.value = `${API_BASE}/api/jobs/${jobIdToUse}/result/model.glb`;
    activeJobQualityPreset.value = selectedPreset.value || activeJobQualityPreset.value || null;
    analysisData.value = {
      watertight: true,
      dimensions: { x: 0, y: 0, z: 0 },
      volume: 0,
    };
    jobStatus.value = 'completed';
    stage.value = 'completed';

    console.log('[handleJobCompletion] Job completed, navigating to preview');

    // Delay navigation so user can see any synthesized/latch stages (texture/finalizing/completed).
    setTimeout(() => {
      isProcessing.value = false;
      currentStepIndex.value = 2; // Go to Preview

      const historyStore = useHistoryStore();
      historyStore.saveToHistory(jobIdToUse);
    }, delayMs);
  }

  // Navigate to Generate step (ProgressView)
  function goToGenerate(options = null) {
    const normalized = normalizeGenerateSettings(options || pendingGenerateSettings.value || {});
    pendingGenerateSettings.value = normalized;
    selectedPreset.value = normalized.modelPreset;
    activeJobQualityPreset.value = normalized.modelPreset;
    isGenerateConfigLocked.value = true;
    currentStepIndex.value = 1;
  }

  // 3. Confirm & Export
  function confirmModel() {
    currentStepIndex.value = 3;
  }

  // Navigate to specific step (used by stepper)
  function navigateToStep(stepIndex) {
    console.log(`[navigateToStep] Attempting to navigate to step ${stepIndex}`);

    // Step 0 (Upload): Always allowed. Move foreground ops to background if needed.
    if (stepIndex === 0) {
      if (isSimulationOpen.value) {
        isSimulationOpen.value = false;
      }
      if (isProcessing.value || isRetexturing.value) {
        continueInBackground();
        return;
      }
      currentStepIndex.value = 0;
      return;
    }

    // Prevent navigating to Generate step if background operation exists
    if (stepIndex === 1) {
      if (backgroundOperation.value.type === 'generate') {
        // Resume the background generate job instead
        console.log('[navigateToStep] Resuming background generate job');
        resumeBackgroundJob();
        return;
      }

      if (backgroundOperation.value.type === 'texture') {
        console.warn('[navigateToStep] Cannot navigate to Generate while texture is processing');
        return;
      }

      // Check if we have a job ready to generate
      if (!jobId.value || !['pending', 'ready'].includes(jobStatus.value)) {
        console.warn('[navigateToStep] No job ready to generate');
        return;
      }
    }

    // Prevent navigating to Preview if no completed model available
    if (stepIndex === 2) {
      // If there's a background generate job for the CURRENT job, don't navigate to Preview yet
      if (backgroundOperation.value.type === 'generate' && backgroundOperation.value.jobId === jobId.value) {
        console.warn('[navigateToStep] Cannot view Preview while current job is generating in background');
        return;
      }

      // If background generate is for different job, allow viewing other models
      // If no model available for current job, don't navigate
      if (!modelUrl.value && backgroundOperation.value.type !== 'generate') {
        console.warn('[navigateToStep] No model available to preview');
        return;
      }
    }

    // Prevent navigating to Export without completed model
    if (stepIndex === 3) {
      if (!modelUrl.value || jobStatus.value !== 'completed') {
        console.warn('[navigateToStep] Cannot navigate to Export without completed model');
        return;
      }
    }

    currentStepIndex.value = stepIndex;
  }

  function openSimulation() {
    isSimulationOpen.value = true;
  }

  function closeSimulation() {
    isSimulationOpen.value = false;
  }

  function setSimulationStlFile(file) {
    simulationStlFile.value = file || null;
  }

  function loadFromHistory(historyJobId, meta = {}) {
    console.log(`[loadFromHistory] Loading job ${historyJobId}, current background:`, backgroundOperation.value);

    // CRITICAL: Never stop polling for background operations
    // Only stop if we're switching away from a foreground operation
    if (pollingJobId && pollingJobId !== historyJobId) {
      if (backgroundOperation.value.type === 'generate' && backgroundOperation.value.jobId === pollingJobId) {
        console.log('[loadFromHistory] Keeping background generate polling active');
        // Don't stop polling - background job is running
      } else {
        console.log('[loadFromHistory] Stopping foreground polling');
        stopPolling();
      }
    }

    // Same for retexture polling — keep polling alive if retexture is still processing
    if (retexturePollingInterval && jobId.value !== historyJobId) {
      if (backgroundOperation.value.type === 'texture' && backgroundOperation.value.jobId === jobId.value) {
        console.log('[loadFromHistory] Keeping background texture polling active');
        // Don't stop polling - background texture is running
      } else if (retextureStatus.value === 'processing' || retextureStatus.value === 'cancelling') {
        console.log('[loadFromHistory] Moving retexture to background for', jobId.value);
        // Move texture operation to background so in-progress card shows in history
        backgroundOperation.value = {
          type: 'texture',
          jobId: jobId.value,
          progress: retextureProgress.value,
          status: retextureStatus.value,
          stage: null,
          startedAt: retextureStartedAt.value || Date.now()
        };
        retextureStatus.value = 'idle';
        const historyStore = useHistoryStore();
        historyStore.addInProgressJob(backgroundOperation.value);
        // Don't stop polling — the captured jobId in the interval will continue polling the correct job
      } else {
        console.log('[loadFromHistory] Stopping foreground retexture polling');
        stopRetexturePolling();
      }
    }

    // Reset specific 3D state before loading new model
    modelScene.value = null;
    bboxSize.value = { x: 0, y: 0, z: 0 };
    userScale.value = { x: 1, y: 1, z: 1 };

    jobId.value = historyJobId;
    activeJobQualityPreset.value = meta.qualityPreset || null;
    if (meta.qualityPreset) {
      selectedPreset.value = meta.qualityPreset;
    }
    modelUrl.value = `${API_BASE}/api/jobs/${historyJobId}/result/model.glb`;
    uploadedImage.value = `${API_BASE}/api/jobs/${historyJobId}/thumbnail`;
    analysisData.value = { watertight: true, dimensions: { x: 0, y: 0, z: 0 }, volume: 0 };
    error.value = null;
    isProcessing.value = false;
    jobStatus.value = 'completed';
    stage.value = 'completed';
    progress.value = 100;
    jobStartedAt.value = null;
    uiStage.value = 'completed';
    uiStageSince.value = Date.now();
    uiStageQueue.value = [];
    retextureStatus.value = 'idle';
    retextureProgress.value = 0;
    retextureError.value = null;
    retextureStartedAt.value = null;
    lastRetextureRequest.value = null;
    currentStepIndex.value = 2;
  }

  // --- Retexture Actions ---
  async function applyTexture() {
    if (!jobId.value) return;
    if (retextureStatus.value === 'processing' || retextureStatus.value === 'cancelling') return;

    // Check if another operation is running
    const canStart = canStartNewJob();
    if (!canStart.allowed) {
      console.warn('[applyTexture] Blocked:', canStart.reason);
      return;
    }

    lastRetextureRequest.value = { ...textureSettings.value };
    retextureStatus.value = 'processing';
    retextureProgress.value = 0;
    retextureError.value = null;
    retextureStartedAt.value = Date.now();

    // Mark background operation
    backgroundOperation.value = {
      type: 'texture',
      jobId: jobId.value,
      progress: 0,
      status: 'processing',
      stage: null,
      startedAt: retextureStartedAt.value
    };

    try {
      const res = await apiFetch(`/api/jobs/${jobId.value}/retexture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'X-API-Key': API_KEY } : {})
        },
        body: JSON.stringify({
          object_prompt: textureSettings.value.objectPrompt || '',
          style_prompt: textureSettings.value.stylePrompt || '',
          enable_pbr: textureSettings.value.enablePbr,
          negative_prompt: textureSettings.value.negativePrompt || '',
          art_style: textureSettings.value.artStyle,
          resolution: textureSettings.value.resolution,
          ai_model: textureSettings.value.aiModel,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Retexture failed: ${res.status}`);
      }

      startRetexturePolling();
      const historyStore = useHistoryStore();
      historyStore.loadHistory();
    } catch (e) {
      retextureStatus.value = 'failed';
      retextureError.value = e.message;
      backgroundOperation.value.type = null;
      backgroundOperation.value.jobId = null;
    }
  }

  async function cancelRetexture() {
    if (!jobId.value) return;
    if (retextureStatus.value !== 'processing') return;
    retextureStatus.value = 'cancelling';
    retextureError.value = null;
    stopRetexturePolling();
    try {
      const res = await apiFetch(`/api/jobs/${jobId.value}/retexture/cancel`, {
        method: 'POST',
        headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Cancel failed: ${res.status}`);
      }
      retextureStatus.value = data.status === 'cancelled' ? 'idle' : data.status;
      retextureProgress.value = 0;
      modelUrl.value = `${API_BASE}/api/jobs/${jobId.value}/result/model.glb?t=${Date.now()}`;
    } catch (e) {
      retextureStatus.value = 'failed';
      retextureError.value = e.message;
    }
  }

  function startRetexturePolling(targetJobId) {
    stopRetexturePolling();
    // Capture the job ID at start so polling always targets the correct job,
    // even if jobId.value changes due to navigation or multi-tab sync
    const pollingTargetJobId = targetJobId || jobId.value;
    if (!pollingTargetJobId) return;

    retexturePollingInterval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/jobs/${pollingTargetJobId}/retexture/status`);
        if (!res.ok) return;
        const data = await res.json();

        // Check if this is a background texture job
        const isBackgroundTexture = backgroundOperation.value.type === 'texture' &&
                                    backgroundOperation.value.jobId === pollingTargetJobId;

        // Only update foreground state if we're still viewing this job
        const isForeground = !isBackgroundTexture && jobId.value === pollingTargetJobId;

        if (isBackgroundTexture) {
          // Update background state
          backgroundOperation.value.progress = data.progress || 0;
          backgroundOperation.value.status = data.status;

          // Update history card
          const historyStore = useHistoryStore();
          historyStore.updateInProgressJob(pollingTargetJobId, {
            progress: data.progress || 0,
            type: 'texture'
          });
        } else if (isForeground) {
          // Normal foreground update — only if still viewing this job
          retextureStatus.value = data.status;
          retextureProgress.value = data.progress || 0;
          retextureError.value = data.error || null;
        }

        if (data.status === 'completed') {
          stopRetexturePolling();

          // Record actual duration for future ETA accuracy
          const startTs = retextureStartedAt.value || backgroundOperation.value.startedAt;
          if (startTs && lastRetextureRequest.value) {
            const actualDuration = (Date.now() - startTs) / 1000;
            _recordActualDuration(lastRetextureRequest.value, actualDuration);
            console.log(`[Retexture] Recorded actual duration: ${Math.round(actualDuration)}s for settings ${_settingsFingerprint(lastRetextureRequest.value)}`);
          }

          setJobTextureInfo(pollingTargetJobId, {
            textureApplied: true,
            paintApplied: !!(lastRetextureRequest.value?.applyPaint ?? textureSettings.value.applyPaint),
          });

          if (isBackgroundTexture) {
            handleBackgroundJobCompletion(pollingTargetJobId, 'texture');
          } else if (isForeground) {
            // Normal completion - reload model
            modelUrl.value = `${API_BASE}/api/jobs/${pollingTargetJobId}/result/model.glb?t=${Date.now()}`;
          } else {
            // Completed while user navigated away — update status so it's picked up on return
            retextureStatus.value = 'completed';
          }
        } else if (data.status === 'cancelled') {
          stopRetexturePolling();

          if (isBackgroundTexture) {
            backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };
            const historyStore = useHistoryStore();
            historyStore.removeInProgressJob(pollingTargetJobId);
          } else {
            retextureStatus.value = 'idle';
            retextureProgress.value = 0;
            if (isForeground) {
              modelUrl.value = `${API_BASE}/api/jobs/${pollingTargetJobId}/result/model.glb?t=${Date.now()}`;
            }
          }
        } else if (data.status === 'failed') {
          stopRetexturePolling();

          if (isBackgroundTexture) {
            backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };
            const historyStore = useHistoryStore();
            historyStore.markJobCompleted(pollingTargetJobId);
          } else {
            retextureError.value = data.error || 'Texture failed';
          }
        }
      } catch (e) {
        console.warn('[RetexturePolling] Error:', e);
      }
    }, 2000);
  }

  function stopRetexturePolling() {
    if (retexturePollingInterval) {
      clearInterval(retexturePollingInterval);
      retexturePollingInterval = null;
    }
  }

  // --- Background Job Management ---

  /**
   * Move current operation to background, allowing user to navigate away
   */
  function continueInBackground() {
    if (!jobId.value) return;

    const operationType = isProcessing.value ? 'generate' :
                         isRetexturing.value ? 'texture' : null;

    if (!operationType) return;

    console.log(`[continueInBackground] Moving ${operationType} job to background:`, jobId.value);

    // Transfer to background
    backgroundOperation.value = {
      type: operationType,
      jobId: jobId.value,
      progress: operationType === 'generate' ? progress.value : retextureProgress.value,
      status: operationType === 'generate' ? jobStatus.value : retextureStatus.value,
      stage: operationType === 'generate' ? stage.value : null,
      startedAt: operationType === 'generate' ? jobStartedAt.value : (retextureStartedAt.value || Date.now())
    };

    // Clear foreground state so UI shows background indicators
    if (operationType === 'generate') {
      isProcessing.value = false;
    } else if (operationType === 'texture') {
      retextureStatus.value = 'idle';
    }

    // Add to history display
    const historyStore = useHistoryStore();
    historyStore.addInProgressJob(backgroundOperation.value);

    // Navigate to Upload (keep polling active!)
    currentStepIndex.value = 0;
  }

  /**
   * Bring background job back to foreground
   */
  function resumeBackgroundJob() {
    if (!backgroundOperation.value.type) return;

    const bg = backgroundOperation.value;
    console.log(`[resumeBackgroundJob] Resuming ${bg.type} job:`, bg.jobId);

    if (bg.type === 'generate') {
      // Restore generate state
      jobId.value = bg.jobId;
      progress.value = bg.progress;
      jobStatus.value = bg.status;
      stage.value = bg.stage;
      jobStartedAt.value = bg.startedAt;
      isProcessing.value = true;

      // Restore uploadedImage for the job being generated
      uploadedImage.value = `${API_BASE}/api/jobs/${bg.jobId}/thumbnail`;

      // Navigate to ProgressView
      currentStepIndex.value = 1;
    } else if (bg.type === 'texture') {
      // Restore texture state
      jobId.value = bg.jobId;
      retextureProgress.value = bg.progress;
      retextureStatus.value = bg.status;

      // CRITICAL: Reload model URL for the correct job
      modelUrl.value = `${API_BASE}/api/jobs/${bg.jobId}/result/model.glb?t=${Date.now()}`;
      uploadedImage.value = `${API_BASE}/api/jobs/${bg.jobId}/thumbnail`;

      // Navigate to PreviewView
      currentStepIndex.value = 2;
    }

    // Clear background tracking
    backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };

    const historyStore = useHistoryStore();
    historyStore.removeInProgressJob(bg.jobId);
  }

  /**
   * Check if a new job can start (guard against concurrent operations)
   */
  function canStartNewJob() {
    if (isProcessing.value) {
      return { allowed: false, reason: 'A Generate 3D job is currently processing' };
    }

    if (isRetexturing.value) {
      return { allowed: false, reason: 'A Texture job is currently processing' };
    }

    if (backgroundOperation.value.type) {
      const opName = backgroundOperation.value.type === 'generate' ? 'Generate 3D' : 'Texture';
      let etaText;
      if (backgroundOperation.value.type === 'texture') {
        const settings = lastRetextureRequest.value || textureSettings.value;
        const totalEta = estimateTextureEtaSeconds(settings);
        const minSec = Math.max(30, Math.round(totalEta * 0.8));
        const maxSec = Math.max(minSec, Math.round(totalEta * 1.2));
        etaText = `est. ${formatDurationShort(minSec)} - ${formatDurationShort(maxSec)}`;
      } else {
        etaText = `${backgroundOperation.value.progress}%`;
      }
      return {
        allowed: false,
        reason: `${opName} running in background (${etaText})`
      };
    }

    return { allowed: true };
  }

  /**
   * Handle completion of background job (show toast, update history)
   */
  function handleBackgroundJobCompletion(jobIdParam, type) {
    console.log(`[Background] ${type} job completed:`, jobIdParam);

    // Clear background tracking
    backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };

    // If user is at UploadView, clear uploadedImage so upload area is enabled
    if (currentStepIndex.value === 0) {
      console.log('[Background] Clearing uploadedImage to enable fresh upload');
      uploadedImage.value = null;
      jobId.value = null;
    }

    // Update history
    const historyStore = useHistoryStore();
    historyStore.markJobCompleted(jobIdParam);

    // Show toast notification
    const toastStore = useToastStore();
    toastStore.showToast({
      type: 'success',
      title: type === 'generate' ? 'Generation Complete!' : 'Texture Applied!',
      message: 'Your model is ready',
      duration: 5000,
      action: {
        label: 'View',
        onClick: () => {
          loadFromHistory(jobIdParam);
          currentStepIndex.value = 2; // Navigate to Preview
        }
      }
    });
  }

  function reset() {
    // Safety check - warn if resetting with active background operation
    if (backgroundOperation.value.type !== null) {
      console.warn('[reset] Resetting store while background operation is active!', backgroundOperation.value);
    }

    stopPolling();
    stopRetexturePolling();
    clearStorage();
    isGenerateConfigLocked.value = false;
    pendingGenerateSettings.value = null;
    currentStepIndex.value = 0;
    jobId.value = null;
    uploadedImages.value = [];
    modelUrl.value = null;
    analysisData.value = null;
    userScale.value = { x: 1, y: 1, z: 1 };
    bboxSize.value = { x: 0, y: 0, z: 0 };
    modelScene.value = null;
    isSimulationOpen.value = false;
    simulationStlFile.value = null;
    error.value = null;
    progress.value = 0;
    stage.value = null;
    jobStatus.value = null;
    jobStartedAt.value = null;
    uiStage.value = null;
    uiStageSince.value = 0;
    uiStageQueue.value = [];
    clearUiStageTimer();
    selectedPreset.value = 'v2';
    activeJobQualityPreset.value = null;
    enableTexture.value = false;
    completionHandledForJobId = null;
    retextureStatus.value = 'idle';
    retextureProgress.value = 0;
    retextureError.value = null;
    retextureStartedAt.value = null;
    lastRetextureRequest.value = null;
    textureSettings.value = { resolution: 1024, numViews: 4, seed: null, applyPaint: true };
    backgroundOperation.value = { type: null, jobId: null, progress: 0, status: null, stage: null, startedAt: null };
  }

  return {
    steps,
    currentStepIndex,
    currentStep,
    isProcessing,
    isGenerateConfigLocked,
    pendingGenerateSettings,
    isRetexturing,
    progress,
    stage,
    jobStartedAt,
    uiStage,
    uiStageSince,
    error,
    uploadedImage,
    uploadedImages,
    jobId,
    modelUrl,
    analysisData,
    userScale,
    bboxSize,
    modelScene,
    isSimulationOpen,
    simulationStlFile,
    uploadImage,
    jobStatus,
    generate3D,
    syncStatus,
    goToGenerate,
    resumeJob,
    confirmModel,
    navigateToStep,
    openSimulation,
    closeSimulation,
    setSimulationStlFile,
    selectedPreset,
    activeJobQualityPreset,
    enableTexture,
    loadFromHistory,
    getJobTextureInfo,
    setJobTextureInfo,
    reset,
    startPolling,
    stopPolling,
    MODEL_PRESETS,
    // Retexture
    retextureStatus,
    retextureProgress,
    retextureError,
    retextureStartedAt,
    textureSettings,
    lastRetextureRequest,
    applyTexture,
    cancelRetexture,
    startRetexturePolling,
    stopRetexturePolling,
    estimateTextureEtaSeconds,
    formatDurationShort,
    getTextureEtaRemaining,
    // Background jobs
    backgroundOperation,
    hasActiveOperation,
    continueInBackground,
    resumeBackgroundJob,
    canStartNewJob,
  };
});
