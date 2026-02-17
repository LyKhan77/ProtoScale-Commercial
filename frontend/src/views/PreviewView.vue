<script setup>
import { ref, computed, watch, shallowRef, onMounted, onBeforeUnmount } from 'vue';
import { useProcessStore } from '../stores/process';
import { useThemeStore } from '../stores/theme';
import { useHistoryStore } from '../stores/history';
import { API_BASE, apiFetch } from '../utils/api';
import DeleteModal from '../components/DeleteModal.vue';
import { TresCanvas } from '@tresjs/core';
import { OrbitControls, Grid } from '@tresjs/cientos';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Vector3, LoadingManager } from 'three';

const store = useProcessStore();
const theme = useThemeStore();
const historyStore = useHistoryStore();

// Local shallowRef untuk scene (mencegah Vue reactivity pada Three.js objects)
const localModelScene = shallowRef(null);
const cameraControl = ref(null);

const scaleX = ref(1);
const scaleY = ref(1);
const scaleZ = ref(1);
const lockScale = ref(true);

// UI State
const showGrid = ref(true);
const isInspectorCollapsed = ref(false);
const showDeleteModal = ref(false);
const isTransitioning = ref(false);
const activeTab = ref('transform'); // 'transform' | 'texture'
const isApplyHover = ref(false);
const showApplyConfirmModal = ref(false);

const isApplyingTexture = computed(() => ['processing', 'cancelling'].includes(store.retextureStatus));
const canStartNewJob = computed(() => store.canStartNewJob().allowed);

// Ticking timer for ETA countdown (updates every second while applying texture)
const etaTick = ref(0);
let etaTimer = null;
watch(isApplyingTexture, (applying) => {
  if (applying && !etaTimer) {
    etaTimer = setInterval(() => { etaTick.value++; }, 1000);
  } else if (!applying && etaTimer) {
    clearInterval(etaTimer);
    etaTimer = null;
    etaTick.value = 0;
  }
}, { immediate: true });
const textureEtaDisplay = computed(() => {
  void etaTick.value; // force reactivity on tick
  return store.getTextureEtaRemaining();
});
const textureSeedDisplay = computed(() => (
  store.textureSettings.seed === null || store.textureSettings.seed === undefined || store.textureSettings.seed === ''
    ? 'Random'
    : String(store.textureSettings.seed)
));
const textureConfigSummary = computed(() => ([
  { key: 'resolution', label: 'Resolution', value: `${store.textureSettings.resolution}px` },
  { key: 'views', label: 'Views', value: String(store.textureSettings.numViews) },
  { key: 'paint', label: 'Paint', value: store.textureSettings.applyPaint ? 'Enabled' : 'Disabled' },
  { key: 'seed', label: 'Seed', value: textureSeedDisplay.value },
]));
const textureEtaSeconds = computed(() => store.estimateTextureEtaSeconds(store.textureSettings));
const textureEtaRange = computed(() => formatEtaRange(textureEtaSeconds.value));
const textureCubePalette = computed(() => {
  if (theme.isDark) {
    return [
      { '--cube-main': 'rgba(45, 212, 191, 0.20)', '--cube-before': 'rgba(45, 212, 191, 0.40)', '--cube-after': 'rgba(20, 184, 166, 0.28)' },
      { '--cube-main': 'rgba(45, 212, 191, 0.24)', '--cube-before': 'rgba(94, 234, 212, 0.44)', '--cube-after': 'rgba(45, 212, 191, 0.30)' },
      { '--cube-main': 'rgba(20, 184, 166, 0.28)', '--cube-before': 'rgba(45, 212, 191, 0.50)', '--cube-after': 'rgba(13, 148, 136, 0.34)' },
      { '--cube-main': 'rgba(45, 212, 191, 0.32)', '--cube-before': 'rgba(153, 246, 228, 0.52)', '--cube-after': 'rgba(20, 184, 166, 0.38)' },
      { '--cube-main': 'rgba(15, 118, 110, 0.34)', '--cube-before': 'rgba(45, 212, 191, 0.56)', '--cube-after': 'rgba(13, 148, 136, 0.42)' },
      { '--cube-main': 'rgba(94, 234, 212, 0.30)', '--cube-before': 'rgba(45, 212, 191, 0.52)', '--cube-after': 'rgba(20, 184, 166, 0.40)' },
    ];
  }

  return [
    { '--cube-main': 'rgba(35, 35, 43, 0.18)', '--cube-before': 'rgba(35, 35, 43, 0.34)', '--cube-after': 'rgba(17, 24, 39, 0.24)' },
    { '--cube-main': 'rgba(35, 35, 43, 0.22)', '--cube-before': 'rgba(51, 65, 85, 0.40)', '--cube-after': 'rgba(17, 24, 39, 0.30)' },
    { '--cube-main': 'rgba(17, 24, 39, 0.26)', '--cube-before': 'rgba(31, 41, 55, 0.46)', '--cube-after': 'rgba(15, 23, 42, 0.34)' },
    { '--cube-main': 'rgba(31, 41, 55, 0.30)', '--cube-before': 'rgba(71, 85, 105, 0.50)', '--cube-after': 'rgba(30, 41, 59, 0.36)' },
    { '--cube-main': 'rgba(17, 24, 39, 0.32)', '--cube-before': 'rgba(31, 41, 55, 0.52)', '--cube-after': 'rgba(30, 41, 59, 0.40)' },
    { '--cube-main': 'rgba(71, 85, 105, 0.26)', '--cube-before': 'rgba(51, 65, 85, 0.48)', '--cube-after': 'rgba(15, 23, 42, 0.36)' },
  ];
});

const jobTextureInfo = computed(() => store.getJobTextureInfo(store.jobId));
const pendingPaintFlag = computed(() => (
  typeof store.lastRetextureRequest?.applyPaint === 'boolean'
    ? store.lastRetextureRequest.applyPaint
    : !!store.textureSettings.applyPaint
));
const infoPresetBadge = computed(() => {
  const presetKey = (store.activeJobQualityPreset || '').toLowerCase();
  const preset = store.MODEL_PRESETS?.[presetKey];
  if (!preset) {
    return {
      label: 'Unknown',
      className: 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600',
    };
  }

  return {
    label: preset.label,
    className: presetBadgeClass(presetKey),
  };
});
const infoTextureBadge = computed(() => {
  // Check if PBR was enabled during generation from job settings
  const job = store.jobs?.[store.jobId];
  const settings = job?.settings || {};
  const pbrEnabled = settings.enable_pbr !== false; // Default to true if not specified

  return pbrEnabled
    ? { label: 'Applied', className: statusBadgeClass('applied') }
    : { label: 'Not Applied', className: statusBadgeClass('not_applied') };
});
const infoPaintBadge = computed(() => {
  if (store.retextureStatus === 'processing') {
    return pendingPaintFlag.value
      ? { label: 'Applying', className: statusBadgeClass('applying') }
      : { label: 'Not Applied', className: statusBadgeClass('not_applied') };
  }
  if (store.retextureStatus === 'cancelling') {
    return pendingPaintFlag.value
      ? { label: 'Cancelling', className: statusBadgeClass('cancelling') }
      : { label: 'Not Applied', className: statusBadgeClass('not_applied') };
  }
  return jobTextureInfo.value.paintApplied
    ? { label: 'Applied', className: statusBadgeClass('applied') }
    : { label: 'Not Applied', className: statusBadgeClass('not_applied') };
});

function presetBadgeClass(presetKey) {
  if (presetKey === 'v1') {
    return 'bg-blue-50 dark:bg-blue-900/25 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700';
  }
  if (presetKey === 'v2') {
    return 'bg-green-50 dark:bg-green-900/25 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700';
  }
  if (presetKey === 'v3') {
    return 'bg-purple-50 dark:bg-purple-900/25 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700';
  }
  return 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600';
}

function statusBadgeClass(status) {
  if (status === 'applied') {
    return 'bg-green-50 dark:bg-green-900/25 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700';
  }
  if (status === 'applying') {
    return 'bg-blue-50 dark:bg-blue-900/25 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700';
  }
  if (status === 'cancelling') {
    return 'bg-amber-50 dark:bg-amber-900/25 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700';
  }
  return 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600';
}

// Draggable panel state
const panelPosition = ref({ x: 0, y: 0 });
const isDragging = ref(false);
const dragOffset = ref({ x: 0, y: 0 });

function startDrag(event) {
  if (isInspectorCollapsed.value) return;
  isDragging.value = true;
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  dragOffset.value = {
    x: clientX - panelPosition.value.x,
    y: clientY - panelPosition.value.y
  };
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('touchmove', onDrag);
  document.addEventListener('touchend', stopDrag);
}

function onDrag(event) {
  if (!isDragging.value) return;
  event.preventDefault();
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  panelPosition.value = {
    x: clientX - dragOffset.value.x,
    y: clientY - dragOffset.value.y
  };
}

function stopDrag() {
  isDragging.value = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
  document.removeEventListener('touchmove', onDrag);
  document.removeEventListener('touchend', stopDrag);
}

// Bounding box dimensions (in model units, displayed as mm)
const bboxSize = ref({ x: 0, y: 0, z: 0 });
const dimX = ref(0);
const dimY = ref(0);
const dimZ = ref(0);

const isLoadingModel = ref(false);

const PI = Math.PI;

// Unit conversion: 1 model unit = 10mm
const UNIT_TO_MM = 10;

const canvasColor = computed(() => theme.isDark ? '#1F2937' : '#F9FAFB');
const gridColor = computed(() => theme.isDark ? '#374151' : '#CCCCCC');
const gridSectionColor = computed(() => theme.isDark ? '#6B7280' : '#888888');

// Action to trigger delete modal
function deleteCurrentModel() {
  if (isApplyingTexture.value) return;
  showDeleteModal.value = true;
}

// Actual delete logic
async function confirmDeleteModel() {
  try {
    if (store.jobId) {
      await historyStore.deleteModel(store.jobId);
    }
    // Reset state and go back to upload
    store.reset();
  } catch (error) {
    console.error('Failed to delete model:', error);
    alert('Failed to delete model. It might have been already removed.');
  } finally {
    showDeleteModal.value = false;
  }
}

// Load GLB with retry for transient proxy errors
function loadGLB(url, retriesLeft = 3, retryDelay = 2000) {
  // Dispose previous model if exists
  if (localModelScene.value) {
    disposeModel(localModelScene.value);
  }

  isLoadingModel.value = true;
  store.error = null;

  // Safety Timeout: Force stop loading after 90 seconds (Ultra models can be large)
  const timeoutId = setTimeout(() => {
    if (isLoadingModel.value) {
      console.warn('Model loading timed out');
      isLoadingModel.value = false;
      store.error = 'Model loading timed out. Please try refreshing.';
    }
  }, 90000);

  // Create custom loading manager with fetch that includes required headers
  const manager = new LoadingManager();
  manager.setURLModifier((resourceUrl) => {
    // For external URLs (API), fetch with custom headers and return blob URL
    if (resourceUrl.startsWith('http')) {
      return resourceUrl; // Will be handled by custom fetch in loader
    }
    return resourceUrl;
  });

  const loader = new GLTFLoader(manager);

  // Override the loader's file loader to add custom headers
  const originalLoad = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    // Fetch with custom headers for ngrok compatibility
    fetch(url, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
      credentials: 'include', // Include cookies for CORS
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        // Use the original loader with the blob URL
        originalLoad(blobUrl, (gltf) => {
          // Clean up blob URL after loading
          URL.revokeObjectURL(blobUrl);
          if (onLoad) onLoad(gltf);
        }, onProgress, (err) => {
          URL.revokeObjectURL(blobUrl);
          if (onError) onError(err);
        });
      })
      .catch(err => {
        if (onError) onError(err);
      });
  };

  loader.load(url, (gltf) => {
    clearTimeout(timeoutId); // Clear timeout on success
    const scene = gltf.scene;

    // Clear timeout error if model loaded late (after timeout had fired)
    if (store.error === 'Model loading timed out. Please try refreshing.') {
      store.error = null;
    }

    // Simpan scene di local component dan store (untuk ExportView)
    localModelScene.value = scene;
    store.modelScene = scene;

    // Compute bounding box
    const box = new Box3().setFromObject(scene);
    const size = new Vector3();
    box.getSize(size);
    bboxSize.value = { x: size.x, y: size.y, z: size.z };

    // Initialize dimensions in mm (assume 1 unit = 1mm for now)
    dimX.value = parseFloat((size.x * UNIT_TO_MM).toFixed(1));
    dimY.value = parseFloat((size.y * UNIT_TO_MM).toFixed(1));
    dimZ.value = parseFloat((size.z * UNIT_TO_MM).toFixed(1));

    // Fix: Immediately sync bboxSize to store so ExportView has data even if no scale change happens
    store.bboxSize = { x: size.x, y: size.y, z: size.z };

    // Update analysis data with real dimensions
    if (store.analysisData) {
      store.analysisData.dimensions = {
        x: parseFloat(dimX.value.toFixed(1)),
        y: parseFloat(dimY.value.toFixed(1)),
        z: parseFloat(dimZ.value.toFixed(1)),
      };
    }

    isLoadingModel.value = false;
  },
  (xhr) => {
    // Optional: Add loading progress logic here if needed
  },
  (err) => {
    clearTimeout(timeoutId); // Clear timeout on error
    console.error('GLB load error:', err);

    // Retry on server/proxy errors (500, network errors)
    const isServerError = err?.message?.includes('500') || err?.message?.includes('Internal Server Error');
    const isNetworkError = err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError');
    if (retriesLeft > 0 && (isServerError || isNetworkError)) {
      console.log(`[GLB Retry] Retrying in ${retryDelay}ms (${retriesLeft} retries left)`);
      setTimeout(() => loadGLB(url, retriesLeft - 1, retryDelay), retryDelay);
      return;
    }

    isLoadingModel.value = false;
    store.error = 'Failed to load 3D model. The server may be temporarily unavailable.';
  });
}

// Load GLB when modelUrl changes
watch(() => store.modelUrl, (url) => {
  if (!url) return;
  loadGLB(url);
}, { immediate: true });

watch(() => store.retextureStatus, (status) => {
  if (status === 'processing' || status === 'cancelling' || status === 'completed') {
    showApplyConfirmModal.value = false;
  }
});

// Cleanup Three.js resources
function disposeModel(scene) {
  if (!scene) return;
  scene.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    }
  });
}

function resetCamera() {
  if (cameraControl.value) {
    cameraControl.value.value.reset();
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes === 0) return `${remainder}s`;
  if (remainder === 0) return `${minutes}m`;
  return `${minutes}m ${remainder}s`;
}

function formatEtaRange(seconds) {
  const minSec = Math.max(30, Math.round(seconds * 0.8));
  const maxSec = Math.max(minSec, Math.round(seconds * 1.2));
  return `${formatDuration(minSec)} - ${formatDuration(maxSec)}`;
}

function openApplyConfirmModal() {
  if (isApplyingTexture.value) return;
  showApplyConfirmModal.value = true;
}

function closeApplyConfirmModal() {
  if (isApplyingTexture.value) return;
  showApplyConfirmModal.value = false;
}

async function confirmApplyTexture() {
  if (isApplyingTexture.value) return;
  showApplyConfirmModal.value = false;
  await store.applyTexture();
}

// Resume retexture polling if page was refreshed during processing
onMounted(async () => {
  // If retexture was processing when page was refreshed, resume polling
  if (store.jobId && (store.retextureStatus === 'processing' || store.retextureStatus === 'cancelling')) {
    console.log('[PreviewView] Resuming retexture polling after page refresh');
    store.startRetexturePolling(store.jobId);
  }

  // Safety net: check backend retexture status in case local state was lost
  // (e.g., from navigating away and back, or multi-tab sync overwriting status)
  if (store.jobId && store.retextureStatus !== 'processing' && store.retextureStatus !== 'cancelling') {
    try {
      const res = await apiFetch(`/api/jobs/${store.jobId}/retexture/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'processing' || data.status === 'cancelling') {
          console.log('[PreviewView] Backend retexture still active, resuming polling');
          store.retextureStatus = data.status;
          store.retextureProgress = data.progress || 0;
          store.startRetexturePolling(store.jobId);
        } else if (data.status === 'completed' && store.retextureStatus !== 'completed') {
          console.log('[PreviewView] Backend retexture completed while away, updating state');
          store.retextureStatus = 'completed';
          store.modelUrl = `${API_BASE}/api/jobs/${store.jobId}/result/model.glb?t=${Date.now()}`;
        }
      }
    } catch (e) {
      // Non-critical — polling will handle it if available
    }
  }

  // Auto-resume background texture job if user navigated back to PreviewView
  if (store.backgroundOperation.type === 'texture' &&
      store.backgroundOperation.jobId === store.jobId &&
      store.currentStepIndex === 2) {
    console.log('[PreviewView] Auto-resuming background texture job');

    // Restore texture state to foreground
    store.retextureStatus = store.backgroundOperation.status;
    store.retextureProgress = store.backgroundOperation.progress;

    // Clear background operation
    store.backgroundOperation = {
      type: null,
      jobId: null,
      progress: 0,
      status: null,
      stage: null,
      startedAt: null
    };

    // Remove from history in-progress list
    historyStore.removeInProgressJob(store.jobId);
  }
});

onBeforeUnmount(() => {
  if (etaTimer) {
    clearInterval(etaTimer);
    etaTimer = null;
  }
  if (localModelScene.value) {
    disposeModel(localModelScene.value);
    localModelScene.value = null;
    store.modelScene = null;
  }
});

// Per-axis scale with lock
function updateScaleX(val) {
  const v = parseFloat(val);
  if (lockScale.value) {
    scaleX.value = scaleY.value = scaleZ.value = v;
    updateDimsFromScale();
  } else {
    scaleX.value = v;
    dimX.value = parseFloat((bboxSize.value.x * v * UNIT_TO_MM).toFixed(1));
  }
  syncStoreScale();
}
function updateScaleY(val) {
  const v = parseFloat(val);
  if (lockScale.value) {
    scaleX.value = scaleY.value = scaleZ.value = v;
    updateDimsFromScale();
  } else {
    scaleY.value = v;
    dimY.value = parseFloat((bboxSize.value.y * v * UNIT_TO_MM).toFixed(1));
  }
  syncStoreScale();
}
function updateScaleZ(val) {
  const v = parseFloat(val);
  if (lockScale.value) {
    scaleX.value = scaleY.value = scaleZ.value = v;
    updateDimsFromScale();
  } else {
    scaleZ.value = v;
    dimZ.value = parseFloat((bboxSize.value.z * v * UNIT_TO_MM).toFixed(1));
  }
  syncStoreScale();
}

function updateDimsFromScale() {
  dimX.value = parseFloat((bboxSize.value.x * scaleX.value * UNIT_TO_MM).toFixed(1));
  dimY.value = parseFloat((bboxSize.value.y * scaleY.value * UNIT_TO_MM).toFixed(1));
  dimZ.value = parseFloat((bboxSize.value.z * scaleZ.value * UNIT_TO_MM).toFixed(1));
}

// Dimension input → scale
function updateDimX(val) {
  const v = parseFloat(val) || 0;
  dimX.value = v;
  if (bboxSize.value.x > 0) {
    scaleX.value = parseFloat((v / (bboxSize.value.x * UNIT_TO_MM)).toFixed(3));
    if (lockScale.value) {
      scaleY.value = scaleZ.value = scaleX.value;
      updateDimsFromScale();
    }
  }
  syncStoreScale();
}
function updateDimY(val) {
  const v = parseFloat(val) || 0;
  dimY.value = v;
  if (bboxSize.value.y > 0) {
    scaleY.value = parseFloat((v / (bboxSize.value.y * UNIT_TO_MM)).toFixed(3));
    if (lockScale.value) {
      scaleX.value = scaleZ.value = scaleY.value;
      updateDimsFromScale();
    }
  }
  syncStoreScale();
}
function updateDimZ(val) {
  const v = parseFloat(val) || 0;
  dimZ.value = v;
  if (bboxSize.value.z > 0) {
    scaleZ.value = parseFloat((v / (bboxSize.value.z * UNIT_TO_MM)).toFixed(3));
    if (lockScale.value) {
      scaleX.value = scaleY.value = scaleZ.value;
      updateDimsFromScale();
    }
  }
  syncStoreScale();
}

function syncStoreScale() {
  store.userScale = { x: scaleX.value, y: scaleY.value, z: scaleZ.value };
  store.bboxSize = bboxSize.value;
}
</script>

<template>
  <div class="h-[calc(100vh-160px)] w-full relative transition-colors duration-300">
    <DeleteModal
      :show="showDeleteModal"
      @confirm="confirmDeleteModel"
      @cancel="showDeleteModal = false"
    />

    <!-- Apply Texture Confirmation Modal -->
    <div
      v-if="showApplyConfirmModal"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
    >
      <div class="w-[min(520px,92vw)] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-5">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h2 class="font-display text-xl font-bold text-brand-dark dark:text-white">Confirm Apply Texture</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Verify parameters before starting texture generation.
            </p>
          </div>
          <button
            @click="closeApplyConfirmModal"
            class="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-4">
          <div
            v-for="item in textureConfigSummary"
            :key="item.key"
            class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 p-3"
          >
            <p class="text-[10px] uppercase tracking-wider text-gray-400">{{ item.label }}</p>
            <p class="text-sm font-mono font-semibold text-brand-dark dark:text-white mt-1">{{ item.value }}</p>
          </div>
        </div>

        <div class="mb-5 rounded-lg border border-brand-dark/20 dark:border-brand-teal/30 bg-brand-dark/5 dark:bg-brand-teal/10 p-3">
          <p class="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Estimated Processing Time</p>
          <p class="text-sm font-mono font-bold text-brand-dark dark:text-brand-teal mt-1">~{{ textureEtaRange }}</p>
        </div>

        <div class="flex justify-end gap-2">
          <button
            @click="closeApplyConfirmModal"
            class="px-4 py-2 rounded-full text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            @click="confirmApplyTexture"
            class="px-5 py-2 rounded-full text-sm font-bold bg-brand-dark dark:bg-brand-teal text-white hover:opacity-90 transition-opacity"
          >
            Confirm Apply
          </button>
        </div>
      </div>
    </div>

    <!-- Loading Overlay -->
    <div v-if="store.isProcessing || isLoadingModel" class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/90 dark:bg-gray-900/90 transition-colors duration-300">
      <div class="w-12 h-12 border-4 border-brand-teal border-t-transparent rounded-full animate-spin mb-6"></div>
      <div class="text-center">
        <h2 class="font-display text-xl font-bold mb-1 text-brand-dark dark:text-white transition-colors duration-300">
          {{ isLoadingModel ? 'Loading Model' : 'Reconstructing Geometry' }}
        </h2>
        <p class="font-mono text-sm text-gray-500 dark:text-gray-400">
          {{ isLoadingModel ? 'PARSING GLB...' : 'VOXELIZATION IN PROGRESS...' }}
        </p>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="store.error" class="absolute top-4 left-4 z-40 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm max-w-sm">
      {{ store.error }}
    </div>

    <!-- 3D Viewport -->
    <TresCanvas v-if="!store.isProcessing && !isLoadingModel" window-size :clear-color="canvasColor">
      <TresPerspectiveCamera :position="[3, 3, 3]" :look-at="[0, 0, 0]" />
      <OrbitControls ref="cameraControl" />

      <!-- Enhanced Lighting Setup for Textured Models -->
      <!-- 1. Stronger ambient - global base illumination -->
      <TresAmbientLight :intensity="7.0" />

      <!-- 2. Brighter hemisphere light - key for outdoor look -->
      <TresHemisphereLight :args="[0xffffff, 0x999999, 6.0]" :position="[0, 20, 0]" />

      <!-- 3. Main light - stronger, from camera angle -->
      <TresDirectionalLight :position="[5, 10, 7]" :intensity="1.5" :cast-shadow="false" />

      <!-- 4. Fill light - brighter to eliminate dark areas -->
      <TresDirectionalLight :position="[-5, 5, -5]" :intensity="1.2" :cast-shadow="false" />

      <!-- 5. Top light - illuminate from above -->
      <TresDirectionalLight :position="[0, 10, 0]" :intensity="1.0" :cast-shadow="false" />

      <!-- 6. Front light - strong frontal illumination -->
      <TresDirectionalLight :position="[0, 0, 8]" :intensity="1.5" :cast-shadow="false" />

      <!-- 7. Back light - eliminate shadows from behind -->
      <TresDirectionalLight :position="[0, 5, -8]" :intensity="0.8" :cast-shadow="false" />

      <!-- Real GLB model -->
      <primitive v-if="localModelScene" :object="localModelScene" :scale="[scaleX, scaleY, scaleZ]" />

      <!-- Fallback placeholder -->
      <TresMesh v-else :scale="[scaleX, scaleY, scaleZ]">
        <TresTorusKnotGeometry :args="[0.8, 0.3, 100, 16]" />
        <TresMeshStandardMaterial color="#564D4D" :roughness="0.3" :metalness="0.5" />
      </TresMesh>

      <!-- Floor Grid (XZ) -->
      <Grid v-if="showGrid" :args="[10, 10]" :cell-color="gridColor" :section-color="gridSectionColor" :fade-distance="20" />
      <!-- Vertical Grid (XY) -->
      <Grid v-if="showGrid" :args="[10, 10]" :cell-color="gridColor" :section-color="gridSectionColor" :fade-distance="20" :rotation="[PI / 2, 0, 0]" />
      <!-- Vertical Grid (YZ) -->
      <Grid v-if="showGrid" :args="[10, 10]" :cell-color="gridColor" :section-color="gridSectionColor" :fade-distance="20" :rotation="[0, 0, PI / 2]" />
    </TresCanvas>

    <!-- NEW UI OVERLAYS -->
    <div v-show="!store.isProcessing && !isLoadingModel" class="absolute inset-0 pointer-events-none">

      <!-- Proceed to Export Button (Center Bottom) -->
      <div class="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto z-30">
        <div class="bg-white/80 dark:bg-gray-800/80 backdrop-blur p-1.5 rounded-full shadow-xl border border-white/20 dark:border-gray-700/50">
          <button
            @click="store.confirmModel"
            :disabled="store.retextureStatus === 'processing' || store.retextureStatus === 'cancelling'"
            class="bg-brand-dark dark:bg-brand-teal text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-gray-500/30 dark:shadow-teal-500/30 hover:shadow-gray-500/50 dark:hover:shadow-teal-500/50 hover:scale-105 transition-all flex items-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:scale-100"
          >
            <span>Proceed to Export</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Draggable Inspector Panel -->
      <div
        class="absolute pointer-events-auto z-40"
        :style="isInspectorCollapsed
          ? { right: '12px', top: '12px' }
          : { right: '12px', top: '12px', transform: `translate(${panelPosition.x}px, ${panelPosition.y}px)` }"
      >
        <div
          class="bg-white/90 dark:bg-gray-800/90 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg transition-all duration-300"
          :class="[
            isInspectorCollapsed ? 'w-10 h-10 rounded-full p-0 flex items-center justify-center cursor-pointer hover:bg-white dark:hover:bg-gray-700 overflow-hidden' : 'w-72 max-h-[calc(100vh-100px)] overflow-hidden flex flex-col',
            isDragging ? 'cursor-grabbing shadow-2xl scale-[1.02]' : ''
          ]"
        >
          <!-- Drag Handle (visible when expanded) - Only this area can be dragged -->
          <div
            v-if="!isInspectorCollapsed"
            class="h-6 flex items-center justify-center cursor-grab active:cursor-grabbing border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/30 select-none"
            @mousedown="startDrag"
            @touchstart="startDrag"
          >
            <div class="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
          </div>
          <!-- Collapsed State Trigger -->
          <button 
            v-if="isInspectorCollapsed" 
            @click="isInspectorCollapsed = false"
            title="Open Properties"
            class="w-full h-full flex items-center justify-center text-gray-500 dark:text-gray-400"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>

          <!-- Expanded Panel Content -->
          <div v-else class="p-4 overflow-y-auto flex-1">
            <!-- Header with View Controls -->
            <div class="flex justify-between items-center mb-4 pb-2 border-b border-gray-100 dark:border-gray-700">
              <h3 class="font-mono text-xs font-bold text-gray-400 uppercase tracking-wider">Properties</h3>
              <div class="flex items-center gap-3">
                <!-- Delete / Reset Project Button -->
                <button
                  @click="deleteCurrentModel"
                  :disabled="isApplyingTexture"
                  class="bin-button"
                  :class="isApplyingTexture ? 'opacity-50 cursor-not-allowed' : ''"
                  title="Delete Model & Start Over"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 69 14"
                    class="svgIcon bin-top"
                  >
                    <g clip-path="url(#clip0_35_24)">
                      <path
                        class="fill-gray-500 dark:fill-gray-400 group-hover:fill-white transition-colors"
                        d="M20.8232 2.62734L19.9948 4.21304C19.8224 4.54309 19.4808 4.75 19.1085 4.75H4.92857C2.20246 4.75 0 6.87266 0 9.5C0 12.1273 2.20246 14.25 4.92857 14.25H64.0714C66.7975 14.25 69 12.1273 69 9.5C69 6.87266 66.7975 4.75 64.0714 4.75H49.8915C49.5192 4.75 49.1776 4.54309 49.0052 4.21305L48.1768 2.62734C47.3451 1.00938 45.6355 0 43.7719 0H25.2281C23.3645 0 21.6549 1.00938 20.8232 2.62734ZM64.0023 20.0648C64.0397 19.4882 63.5822 19 63.0044 19H5.99556C5.4178 19 4.96025 19.4882 4.99766 20.0648L8.19375 69.3203C8.44018 73.0758 11.6746 76 15.5712 76H53.4288C57.3254 76 60.5598 73.0758 60.8062 69.3203L64.0023 20.0648Z"
                      ></path>
                    </g>
                    <defs>
                      <clipPath id="clip0_35_24">
                        <rect fill="white" height="14" width="69"></rect>
                      </clipPath>
                    </defs>
                  </svg>

                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 69 57"
                    class="svgIcon bin-bottom"
                  >
                    <g clip-path="url(#clip0_35_22)">
                      <path
                        class="fill-gray-500 dark:fill-gray-400 group-hover:fill-white transition-colors"
                        d="M20.8232 -16.3727L19.9948 -14.787C19.8224 -14.4569 19.4808 -14.25 19.1085 -14.25H4.92857C2.20246 -14.25 0 -12.1273 0 -9.5C0 -6.8727 2.20246 -4.75 4.92857 -4.75H64.0714C66.7975 -4.75 69 -6.8727 69 -9.5C69 -12.1273 66.7975 -14.25 64.0714 -14.25H49.8915C49.5192 -14.25 49.1776 -14.4569 49.0052 -14.787L48.1768 -16.3727C47.3451 -17.9906 45.6355 -19 43.7719 -19H25.2281C23.3645 -19 21.6549 -17.9906 20.8232 -16.3727ZM64.0023 1.0648C64.0397 0.4882 63.5822 0 63.0044 0H5.99556C5.4178 0 4.96025 0.4882 4.99766 1.0648L8.19375 50.3203C8.44018 54.0758 11.6746 57 15.5712 57H53.4288C57.3254 57 60.5598 54.0758 60.8062 50.3203L64.0023 1.0648Z"
                      ></path>
                    </g>
                    <defs>
                      <clipPath id="clip0_35_22">
                        <rect fill="white" height="57" width="69"></rect>
                      </clipPath>
                    </defs>
                  </svg>
                </button>
                
                <!-- Collapse -->
                <button 
                  @click="isInspectorCollapsed = true"
                  title="Collapse Panel"
                  class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors rounded"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- View Settings (Grid Toggle) -->
            <div class="mb-4 bg-gray-50 dark:bg-gray-700/30 p-2 rounded-lg flex items-center justify-between">
              <span class="text-xs font-medium text-gray-600 dark:text-gray-300">Show Floor Grid</span>
              <button 
                @click="showGrid = !showGrid"
                class="relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus:outline-none"
                :class="showGrid ? 'bg-brand-dark dark:bg-brand-teal' : 'bg-gray-300 dark:bg-gray-600'"
              >
                <span 
                  class="inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out"
                  :class="showGrid ? 'translate-x-4' : 'translate-x-0.5'"
                />
              </button>
            </div>

            <!-- Properties Header -->
            <div class="mb-4">
              <h3 class="text-xs font-bold text-brand-dark dark:text-gray-300">TRANSFORM</h3>
            </div>

            <!-- Transform Content -->
            <div class="space-y-6">
              <!-- Transform Section -->
              <div>
                <div class="flex justify-between items-center mb-2">
                  <label class="text-xs font-bold text-brand-dark dark:text-gray-300">SCALE</label>
                  <!-- Lock Icon -->
                  <button
                    @click="lockScale = !lockScale"
                    :title="lockScale ? 'Unlock Scale' : 'Lock Scale'"
                    class="p-1 rounded transition-colors"
                    :class="lockScale ? 'text-brand-dark dark:text-brand-teal bg-gray-200 dark:bg-teal-900/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'"
                  >
                    <svg v-if="lockScale" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>

                <!-- Scale Controls -->
                <div class="space-y-3">
                  <!-- Uniform Scale -->
                  <div v-if="lockScale" class="bg-gray-50 dark:bg-gray-700/50 p-2 rounded-lg">
                    <div class="flex justify-between text-xs mb-1 text-gray-500 dark:text-gray-400">
                      <span>Uniform Scale</span>
                      <span class="font-mono text-brand-dark dark:text-white">{{ scaleX.toFixed(2) }}x</span>
                    </div>
                    <input
                      type="range" min="0.1" max="5.0" step="0.01"
                      :value="scaleX"
                      @input="updateScaleX($event.target.value)"
                      class="w-full h-1 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-dark dark:accent-brand-teal"
                    />
                  </div>
                  
                  <!-- Per Axis Scale -->
                  <div v-else class="space-y-2">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-mono text-red-500 w-3">X</span>
                      <input type="range" min="0.1" max="5.0" step="0.01" :value="scaleX" @input="updateScaleX($event.target.value)" class="flex-1 h-1 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-red-500" />
                      <span class="text-xs font-mono w-8 text-right dark:text-gray-300">{{ scaleX.toFixed(1) }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-mono text-green-500 w-3">Y</span>
                      <input type="range" min="0.1" max="5.0" step="0.01" :value="scaleY" @input="updateScaleY($event.target.value)" class="flex-1 h-1 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500" />
                      <span class="text-xs font-mono w-8 text-right dark:text-gray-300">{{ scaleY.toFixed(1) }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-mono text-blue-500 w-3">Z</span>
                      <input type="range" min="0.1" max="5.0" step="0.01" :value="scaleZ" @input="updateScaleZ($event.target.value)" class="flex-1 h-1 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                      <span class="text-xs font-mono w-8 text-right dark:text-gray-300">{{ scaleZ.toFixed(1) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Dimensions Section -->
              <div>
                <label class="text-xs font-bold text-brand-dark dark:text-gray-300 mb-2 block">DIMENSIONS (mm)</label>
                <div class="grid grid-cols-3 gap-2">
                  <div class="bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-100 dark:border-gray-600">
                    <label class="text-[10px] text-gray-400 block mb-1">W (X)</label>
                    <input
                      type="number" step="0.1" min="0"
                      :value="dimX"
                      @input="updateDimX($event.target.value)"
                      class="w-full text-xs font-mono bg-transparent border-none p-0 text-brand-dark dark:text-white focus:ring-0"
                    />
                  </div>
                  <div class="bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-100 dark:border-gray-600">
                    <label class="text-[10px] text-gray-400 block mb-1">H (Y)</label>
                    <input
                      type="number" step="0.1" min="0"
                      :value="dimY"
                      @input="updateDimY($event.target.value)"
                      class="w-full text-xs font-mono bg-transparent border-none p-0 text-brand-dark dark:text-white focus:ring-0"
                    />
                  </div>
                  <div class="bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-100 dark:border-gray-600">
                    <label class="text-[10px] text-gray-400 block mb-1">D (Z)</label>
                    <input
                      type="number" step="0.1" min="0"
                      :value="dimZ"
                      @input="updateDimZ($event.target.value)"
                      class="w-full text-xs font-mono bg-transparent border-none p-0 text-brand-dark dark:text-white focus:ring-0"
                    />
                  </div>
                </div>
              </div>

              <!-- Info Section -->
              <div class="pt-4 border-t border-gray-100 dark:border-gray-700">
                <label class="text-xs font-bold text-brand-dark dark:text-gray-300 mb-2 block">INFO</label>
                <div class="space-y-2">
                  <div class="bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-600 rounded p-2 flex justify-between items-center">
                    <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">AI Model</span>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase"
                      :class="infoPresetBadge.className"
                    >
                      {{ infoPresetBadge.label }}
                    </span>
                  </div>

                  <div class="bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-600 rounded p-2 flex justify-between items-center">
                    <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">PBR Texture</span>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase"
                      :class="infoTextureBadge.className"
                    >
                      {{ infoTextureBadge.label }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Texture Tab Content -->

          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.bin-button {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background-color: transparent; /* Default transparent to blend in header */
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition-duration: 0.3s;
  overflow: hidden;
  position: relative;
  gap: 1px;
}

/* Dark mode adjustment if needed handled by utility classes on parent or svg */

.svgIcon {
  width: 10px;
  transition-duration: 0.3s;
}

.bin-button:hover {
  background-color: rgb(255, 69, 69);
  align-items: center;
  gap: 0;
}

.bin-button:disabled:hover {
  background-color: transparent;
  gap: 1px;
}

.bin-top {
  transform-origin: bottom right;
}
.bin-button:hover .bin-top {
  transition-duration: 0.5s;
  transform: rotate(160deg);
}

.bin-button:disabled:hover .bin-top {
  transform: none;
}

.texture-loader-shell {
  position: relative;
  height: 90px;
  overflow: hidden;
  font-size: 8px;
}

.cubes {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-style: preserve-3d;
}

.loop {
  transform: rotateX(-35deg) rotateY(-45deg) translateZ(1.5625em);
}

@keyframes s {
  to {
    transform: scale3d(0.2, 0.2, 0.2);
  }
}

.item {
  margin: -1.5625em;
  width: 3.125em;
  height: 3.125em;
  transform-origin: 50% 50% -1.5625em;
  box-shadow: 0 0 0.125em var(--cube-main, currentColor);
  background: var(--cube-main, currentColor);
  animation: s 0.6s cubic-bezier(0.45, 0.03, 0.51, 0.95) infinite alternate;
}

.item:before,
.item:after {
  position: absolute;
  width: inherit;
  height: inherit;
  transform-origin: 0 100%;
  box-shadow: inherit;
  content: "";
}

.item:before {
  bottom: 100%;
  transform: rotateX(90deg);
  background: var(--cube-before, var(--cube-main, currentColor));
}

.item:after {
  left: 100%;
  transform: rotateY(90deg);
  background: var(--cube-after, var(--cube-main, currentColor));
}

.item:nth-child(1) {
  margin-top: 6.25em;
  animation-delay: -1.2s;
}

.item:nth-child(2) {
  margin-top: 3.125em;
  animation-delay: -1s;
}

.item:nth-child(3) {
  margin-top: 0em;
  animation-delay: -0.8s;
}

.item:nth-child(4) {
  margin-top: -3.125em;
  animation-delay: -0.6s;
}

.item:nth-child(5) {
  margin-top: -6.25em;
  animation-delay: -0.4s;
}

.item:nth-child(6) {
  margin-top: -9.375em;
  animation-delay: -0.2s;
}

.apply-texture-loading {
  position: absolute;
  left: -40%;
  bottom: 0;
  height: 3px;
  width: 40%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.2),
    rgba(255, 255, 255, 0.9),
    rgba(255, 255, 255, 0.2),
    transparent
  );
  animation: applyTextureSweep 1.2s ease-in-out infinite;
  opacity: 0.8;
}

@keyframes applyTextureSweep {
  0% {
    transform: translateX(0);
    opacity: 0.2;
  }
  50% {
    opacity: 0.9;
  }
  100% {
    transform: translateX(250%);
    opacity: 0.2;
  }
}
</style>
