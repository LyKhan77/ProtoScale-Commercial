<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useProcessStore } from '../stores/process';
import { useHistoryStore } from '../stores/history';
import CyberCheckbox from '../components/CyberCheckbox.vue';
import DeleteModal from '../components/DeleteModal.vue';

const store = useProcessStore();
const historyStore = useHistoryStore();

onMounted(() => {
  historyStore.loadHistory();
});

// Ticking timer so in-progress card ETA updates every second
const etaTick = ref(0);
let etaTimer = null;
const hasInProgress = computed(() => historyStore.items.some(i => i.status === 'in_progress'));
watch(hasInProgress, (active) => {
  if (active && !etaTimer) {
    etaTimer = setInterval(() => { etaTick.value++; }, 1000);
  } else if (!active && etaTimer) {
    clearInterval(etaTimer);
    etaTimer = null;
    etaTick.value = 0;
  }
}, { immediate: true });
onBeforeUnmount(() => {
  if (etaTimer) { clearInterval(etaTimer); etaTimer = null; }
});
const isDragging = ref(false);
const fileInput = ref(null);
const removeBackground = ref(true);
const enablePbrTextures = ref(true);
const modelPreset = ref('v2');
const modelType = ref('standard');     // 'standard' | 'lowpoly'
const symmetryMode = ref('auto');      // 'off' | 'auto' | 'on'
const multiViewEnabled = ref(false);
const multiViewFiles = ref([null, null, null]);
const multiViewPreviews = ref([null, null, null]);
const multiViewInputs = ref([null, null, null]);
const showDeleteModal = ref(false);
const modelToDelete = ref(null);
const showGenerateConfirmModal = ref(false);

// When Low Poly is selected, lock AI model to v3 (latest)
watch(modelType, (val) => {
  if (val === 'lowpoly') {
    modelPreset.value = 'v3';
  }
});

// Whether we have an uploaded image ready (not in background mode)
const hasUploadedImage = computed(() =>
  store.uploadedImages.length > 0 && store.jobId && store.backgroundOperation.type === null
);

// Settings locked only after user clicks Generate
const settingsLocked = computed(() => store.isGenerateConfigLocked);

// Upload blocking guards
const canUpload = computed(() => store.canStartNewJob().allowed);
const blockReason = computed(() => store.canStartNewJob().reason);

// In-progress and completed items
const inProgressItems = computed(() =>
  historyStore.items.filter(i => i.status === 'in_progress')
);

const completedItems = computed(() =>
  historyStore.items.filter(i => i.status !== 'in_progress')
);

const effectivePresetKey = computed(() =>
  modelType.value === 'lowpoly' ? 'v3' : modelPreset.value
);

const selectedPresetInfo = computed(() =>
  store.MODEL_PRESETS[effectivePresetKey.value] || store.MODEL_PRESETS.v2
);

const selectedMultiViewCount = computed(() =>
  multiViewFiles.value.filter(Boolean).length
);

const generateConfigSummary = computed(() => [
  { key: 'model', label: 'AI Model', value: selectedPresetInfo.value.label },
  { key: 'type', label: 'Model Type', value: modelType.value === 'lowpoly' ? 'Low Poly' : 'Standard' },
  { key: 'symmetry', label: 'Symmetry', value: symmetryMode.value.toUpperCase() },
  { key: 'bg', label: 'Remove BG', value: removeBackground.value ? 'Enabled' : 'Disabled' },
  { key: 'pbr', label: 'PBR Texture', value: enablePbrTextures.value ? 'Enabled' : 'Disabled' },
  {
    key: 'multiview',
    label: 'Multi-view',
    value: multiViewEnabled.value ? `${selectedMultiViewCount.value} additional view(s)` : 'Disabled'
  },
]);

const generateCredits = computed(() =>
  enablePbrTextures.value
    ? `${selectedPresetInfo.value.creditsTotal} credits (geometry + texture)`
    : `${selectedPresetInfo.value.creditsGeometry} credits (geometry only)`
);

function handleDrop(e) {
  isDragging.value = false;
  if (!canUpload.value) return;
  const files = e.dataTransfer.files;
  if (!files.length) return;
  // If already uploaded, reset first then process new file
  if (hasUploadedImage.value) {
    store.reset();
  }
  processFile(files[0]);
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) processFile(files[0]);
}

function handleMultiViewSelect(idx, e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file (JPG/PNG).');
    return;
  }
  multiViewFiles.value[idx] = file;
  multiViewPreviews.value[idx] = URL.createObjectURL(file);
}

function removeMultiView(idx) {
  if (multiViewPreviews.value[idx]) {
    URL.revokeObjectURL(multiViewPreviews.value[idx]);
  }
  multiViewFiles.value[idx] = null;
  multiViewPreviews.value[idx] = null;
}

function processFile(file) {
  if (!canUpload.value) {
    alert(blockReason.value);
    return;
  }

  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file (JPG/PNG).');
    return;
  }

  // Build file array: source + multi-view
  const files = [file];
  if (multiViewEnabled.value) {
    multiViewFiles.value.forEach(f => { if (f) files.push(f); });
  }

  const effectivePreset = modelType.value === 'lowpoly' ? 'v3' : modelPreset.value;

  store.uploadImage(files, {
    removeBackground: removeBackground.value,
    modelPreset: effectivePreset,
    enableTexture: false,
    enablePbr: enablePbrTextures.value,
    modelType: modelType.value,
    symmetryMode: symmetryMode.value,
  });
}

function reupload() {
  // Only reset if no background operation is running
  if (store.backgroundOperation.type !== null) {
    alert('Cannot re-upload while a job is processing in background. Please wait for completion or resume the job.');
    return;
  }
  store.reset();
}

function deleteModel(jobId) {
  modelToDelete.value = jobId;
  showDeleteModal.value = true;
}

function openGenerateConfirmModal() {
  if (!store.jobStatus || !['pending', 'ready'].includes(store.jobStatus)) return;
  showGenerateConfirmModal.value = true;
}

function closeGenerateConfirmModal() {
  showGenerateConfirmModal.value = false;
}

function confirmGenerate3D() {
  const effectivePreset = modelType.value === 'lowpoly' ? 'v3' : modelPreset.value;
  showGenerateConfirmModal.value = false;
  store.goToGenerate({
    removeBackground: removeBackground.value,
    modelPreset: effectivePreset,
    enablePbr: enablePbrTextures.value,
    modelType: modelType.value,
    symmetryMode: symmetryMode.value,
  });
}

async function confirmDelete() {
  if (!modelToDelete.value) return;

  try {
    await historyStore.deleteModel(modelToDelete.value);
  } catch (e) {
    alert('Failed to delete model.');
  } finally {
    showDeleteModal.value = false;
    modelToDelete.value = null;
  }
}

// Helper functions for in-progress cards
function formatOperationType(item) {
  if (item.type === 'texture') return 'Texturing';
  return formatStage(item.stage);
}

function formatStage(stage) {
  const map = {
    'rembg': 'Removing BG',
    'geometry': 'Generating',
    'texture': 'Texturing',
    'postprocess': 'Finalizing'
  };
  return map[stage] || 'Processing';
}

function getItemProgress(item) {
  void etaTick.value; // force reactivity on tick
  // For texture jobs, compute synthetic progress from elapsed time vs estimated total
  if (item.type === 'texture' && item.startedAt) {
    const settings = store.lastRetextureRequest || store.textureSettings;
    const totalEta = store.estimateTextureEtaSeconds(settings);
    const elapsed = (Date.now() - item.startedAt) / 1000;
    // Cap at 95% so it doesn't show 100% before actually completing
    return Math.min(95, Math.round((elapsed / totalEta) * 100));
  }
  return item.progress;
}

function formatEta(item) {
  void etaTick.value; // force reactivity on tick
  // For texture jobs, use the store's texture ETA (based on settings, not progress)
  if (item.type === 'texture') {
    return store.getTextureEtaRemaining();
  }

  if (!item.startedAt || item.progress >= 100) return 'Almost done';

  const elapsed = (Date.now() - item.startedAt) / 1000;
  const rate = item.progress / elapsed;
  if (rate <= 0) return 'Estimating...';
  const remaining = (100 - item.progress) / rate;

  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);

  if (minutes > 0) return `~${minutes}m ${seconds}s remaining`;
  return `~${seconds}s remaining`;
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[50vh] animate-fade-in relative">
    <DeleteModal
      :show="showDeleteModal"
      @confirm="confirmDelete"
      @cancel="showDeleteModal = false"
    />

    <div
      v-if="showGenerateConfirmModal"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
    >
      <div class="w-[min(540px,92vw)] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-5">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h2 class="font-display text-xl font-bold text-brand-dark dark:text-white">Verify Generate Parameters</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Confirm your selected configuration before starting 3D generation.
            </p>
          </div>
          <button
            @click="closeGenerateConfirmModal"
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
            v-for="item in generateConfigSummary"
            :key="item.key"
            class="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 p-3"
          >
            <p class="text-[10px] uppercase tracking-wider text-gray-400">{{ item.label }}</p>
            <p class="text-sm font-mono font-semibold text-brand-dark dark:text-white mt-1">{{ item.value }}</p>
          </div>
        </div>

        <div class="mb-5 rounded-lg border border-brand-dark/20 dark:border-brand-teal/30 bg-brand-dark/5 dark:bg-brand-teal/10 p-3 space-y-1">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Estimated Time</p>
            <p class="text-sm font-mono font-bold text-brand-dark dark:text-brand-teal">{{ selectedPresetInfo.estimatedTime }}</p>
          </div>
          <div class="flex items-center justify-between gap-3">
            <p class="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Credit Cost</p>
            <p class="text-xs font-mono font-bold text-brand-dark dark:text-brand-teal">{{ generateCredits }}</p>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button
            @click="closeGenerateConfirmModal"
            class="px-4 py-2 rounded-full text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Back
          </button>
          <button
            @click="confirmGenerate3D"
            class="px-5 py-2 rounded-full text-sm font-bold bg-brand-dark dark:bg-brand-teal text-white hover:opacity-90 transition-opacity"
          >
            Confirm & Generate
          </button>
        </div>
      </div>
    </div>

    <!-- Backend Offline Banner -->
    <div v-if="historyStore.backendOnline === false" class="w-full max-w-2xl mb-4 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-300 text-sm flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
      Backend server is unreachable. Check that the server is running and network is connected.
      <button @click="historyStore.loadHistory()" class="ml-auto underline hover:no-underline">Retry</button>
    </div>

    <!-- Error Banner -->
    <div v-if="store.error" class="w-full max-w-2xl mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
      {{ store.error }}
    </div>

    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="font-display text-4xl font-bold mb-2 text-brand-dark dark:text-white transition-colors duration-300">
        {{ hasUploadedImage ? 'Image Ready' : 'Upload Source Image' }}
      </h1>
      <p class="text-gray-500 dark:text-gray-400 max-w-md mx-auto transition-colors duration-300">
        {{ hasUploadedImage
          ? 'Review your image and click Generate to create a 3D model.'
          : 'Select a high-resolution image of the object you wish to convert into 3D geometry.' }}
      </p>
    </div>

    <!-- Unified Dropzone / Preview -->
    <div
      class="w-full max-w-2xl border-2 rounded-xl flex flex-col items-center justify-center transition-all duration-300 relative overflow-hidden"
      :class="[
        hasUploadedImage
          ? [
              'border-solid bg-gray-50 dark:bg-gray-900',
              isDragging ? 'border-brand-dark dark:border-brand-teal bg-brand-dark/5 dark:bg-brand-teal/10' : 'border-gray-200 dark:border-gray-700'
            ]
          : [
              'border-dashed aspect-[16/9] bg-brand-gray/30 dark:bg-gray-800/50 group',
              isDragging ? 'border-brand-dark dark:border-brand-teal bg-brand-dark/5 dark:bg-brand-teal/10' : 'border-gray-300 dark:border-gray-700',
              canUpload ? 'cursor-pointer hover:border-brand-dark dark:hover:border-gray-500' : 'cursor-not-allowed opacity-60'
            ]
      ]"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
      @click="!hasUploadedImage && canUpload && fileInput.click()"
    >
      <input
        type="file"
        ref="fileInput"
        class="hidden"
        accept="image/png, image/jpeg"
        @change="handleFileSelect"
      />

      <!-- Uploading overlay -->
      <Transition name="fade">
        <div v-if="store.isProcessing" class="absolute inset-0 bg-white/80 dark:bg-gray-900/80 z-10 flex flex-col items-center justify-center backdrop-blur-sm">
          <div class="w-8 h-8 border-4 border-brand-dark dark:border-brand-teal border-t-transparent rounded-full animate-spin mb-4"></div>
          <span class="font-mono text-sm animate-pulse text-brand-dark dark:text-white">UPLOADING...</span>
        </div>
      </Transition>

      <!-- Content swap with transition -->
      <Transition name="dropzone" mode="out-in">
        <!-- Empty state: upload prompt -->
        <div v-if="!hasUploadedImage" key="empty" class="flex flex-col items-center gap-4 group-hover:scale-105 transition-transform duration-300">
          <div class="w-16 h-16 rounded-full bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm transition-colors duration-300">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-brand-dark dark:text-white transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div class="text-center">
            <p class="font-medium text-lg text-brand-dark dark:text-white transition-colors duration-300">Click to upload or drag & drop</p>
            <p class="text-sm text-gray-400 mt-1 font-mono">JPG or PNG (Max 10MB)</p>
          </div>
        </div>

        <!-- Uploaded state: image preview -->
        <div v-else key="preview" class="w-full flex flex-col items-center justify-center py-6 px-4">
          <img :src="store.uploadedImage" class="max-h-48 max-w-full object-contain rounded-lg" />
          <!-- Multi-view thumbnails -->
          <div v-if="store.uploadedImages.length > 1" class="flex items-center gap-2 mt-3">
            <div
              v-for="(img, idx) in store.uploadedImages.slice(1)"
              :key="idx"
              class="w-10 h-10 rounded border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800"
            >
              <img :src="img" class="w-full h-full object-contain" />
            </div>
            <span class="text-[10px] text-gray-400 dark:text-gray-500 font-mono ml-1">+{{ store.uploadedImages.length - 1 }} view{{ store.uploadedImages.length > 2 ? 's' : '' }}</span>
          </div>
          <!-- Drag-drop hint -->
          <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-3">Drop a new image to replace</p>
        </div>
      </Transition>

      <!-- Blocking Overlay -->
      <div
        v-if="!canUpload && !hasUploadedImage"
        class="absolute inset-0 bg-white/95 dark:bg-gray-900/95 z-20 flex items-center justify-center backdrop-blur"
      >
        <div class="text-center max-w-xs">
          <svg class="w-12 h-12 text-amber-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p class="font-bold text-brand-dark dark:text-white mb-2">Operation In Progress</p>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {{ blockReason }}
          </p>
          <button
            v-if="store.backgroundOperation.type"
            @click="store.resumeBackgroundJob()"
            class="px-4 py-2 rounded-lg bg-brand-dark dark:bg-brand-teal text-white font-bold hover:opacity-90 transition-opacity"
          >
            Resume Watching
          </button>
        </div>
      </div>
    </div>

    <!-- Action buttons (between dropzone and settings) -->
    <Transition name="fade-slide">
      <div v-if="hasUploadedImage" class="w-full max-w-2xl flex gap-3 mt-4">
        <button
          @click="reupload"
          class="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium transition-colors"
        >Re-upload</button>
        <button
          @click="openGenerateConfirmModal"
          :disabled="!store.jobStatus || !['pending', 'ready'].includes(store.jobStatus)"
          class="flex-1 px-4 py-2.5 rounded-lg bg-brand-dark dark:bg-brand-teal text-white font-bold hover:bg-gray-700 dark:hover:bg-teal-600 transition-colors shadow-lg shadow-gray-500/30 dark:shadow-teal-500/30 hover:shadow-gray-500/50 dark:hover:shadow-teal-500/50 flex items-center justify-center gap-2"
          :class="{ 'opacity-50 cursor-not-allowed': !store.jobStatus || !['pending', 'ready'].includes(store.jobStatus) }"
        >
          <span>Generate 3D Model</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </Transition>

    <!-- Settings (locked once Generate is clicked) -->
    <div class="mt-8 w-full max-w-2xl space-y-6 transition-opacity duration-300" :class="{ 'opacity-50 pointer-events-none': settingsLocked }">
      <!-- AI Model Selection -->
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700" :class="{ 'opacity-50': modelType === 'lowpoly' && !settingsLocked }">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          AI Model
        </label>
        <select
          v-model="modelPreset"
          :disabled="modelType === 'lowpoly' || settingsLocked"
          class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-brand-dark dark:text-white focus:ring-2 focus:ring-brand-dark dark:focus:ring-brand-teal focus:border-transparent transition-colors disabled:cursor-not-allowed"
        >
          <option
            v-for="(preset, key) in store.MODEL_PRESETS"
            :key="key"
            :value="key"
          >
            {{ preset.label }}
          </option>
        </select>
        <p v-if="modelType === 'lowpoly'" class="text-xs text-amber-600 dark:text-amber-400 mt-2">
          Low Poly mode uses latest AI model
        </p>
        <div class="mt-3 space-y-2">
          <div class="flex items-center gap-4 text-xs">
            <div class="flex items-center gap-1">
              <span class="text-gray-500 dark:text-gray-400">Estimated Time:</span>
              <span class="font-mono font-medium text-brand-dark dark:text-brand-teal">{{ store.MODEL_PRESETS[modelPreset].estimatedTime }}</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-gray-500 dark:text-gray-400">Quality:</span>
              <span class="font-medium" :class="{
                'text-blue-600 dark:text-blue-400': modelPreset === 'v1',
                'text-green-600 dark:text-green-400': modelPreset === 'v2',
                'text-purple-600 dark:text-purple-400': modelPreset === 'v3'
              }">{{ store.MODEL_PRESETS[modelPreset].quality }}</span>
            </div>
          </div>
          <div class="text-xs bg-gray-50 dark:bg-gray-700/50 rounded p-2 border border-gray-200 dark:border-gray-600">
            <div class="flex items-center justify-between">
              <span class="text-gray-600 dark:text-gray-400">Credits Cost:</span>
              <div class="flex items-center gap-2 font-mono text-brand-dark dark:text-white">
                <span v-if="enablePbrTextures">
                  <span class="text-gray-500">Geometry:</span> {{ store.MODEL_PRESETS[modelPreset].creditsGeometry }}
                  <span class="text-gray-500 mx-1">+</span>
                  <span class="text-gray-500">Texture:</span> {{ store.MODEL_PRESETS[modelPreset].creditsTexture }}
                  <span class="text-gray-500 mx-1">=</span>
                  <span class="font-bold">{{ store.MODEL_PRESETS[modelPreset].creditsTotal }} credits</span>
                </span>
                <span v-else>
                  <span class="font-bold">{{ store.MODEL_PRESETS[modelPreset].creditsGeometry }} credits</span>
                  <span class="text-gray-500">(Geometry only)</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Model Type -->
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Model Type
        </label>
        <div class="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            @click="!settingsLocked && (modelType = 'standard')"
            class="flex-1 px-4 py-2 text-sm font-medium transition-colors"
            :class="modelType === 'standard'
              ? 'bg-brand-dark dark:bg-brand-teal text-white'
              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'"
          >Standard</button>
          <button
            @click="!settingsLocked && (modelType = 'lowpoly')"
            class="flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 dark:border-gray-600"
            :class="modelType === 'lowpoly'
              ? 'bg-brand-dark dark:bg-brand-teal text-white'
              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'"
          >Low Poly</button>
        </div>
      </div>

      <!-- Symmetry Mode -->
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Symmetry Mode
        </label>
        <div class="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            v-for="opt in [{ value: 'off', label: 'Off' }, { value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }]"
            :key="opt.value"
            @click="!settingsLocked && (symmetryMode = opt.value)"
            class="flex-1 px-4 py-2 text-sm font-medium transition-colors border-l first:border-l-0 border-gray-300 dark:border-gray-600"
            :class="symmetryMode === opt.value
              ? 'bg-brand-dark dark:bg-brand-teal text-white'
              : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'"
          >{{ opt.label }}</button>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {{ symmetryMode === 'off' ? 'No symmetry enforcement' : symmetryMode === 'auto' ? 'AI detects and applies symmetry automatically' : 'Force symmetric mesh output' }}
        </p>
      </div>

      <!-- Remove Background & PBR Toggles -->
      <div class="space-y-4">
        <CyberCheckbox
          v-model="removeBackground"
          label="Remove Background"
          :disabled="settingsLocked"
        />
        <div>
          <CyberCheckbox
            v-model="enablePbrTextures"
            label="Enable PBR Textures"
            :disabled="settingsLocked"
          />
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-2 ml-8">
            Generate with realistic textures and materials. Uncheck for geometry-only output.
          </p>
        </div>
      </div>

      <!-- Multi-view Toggle + Slots -->
      <div class="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div class="flex items-center justify-between mb-3">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Multi-view</label>
          <div class="flex items-center gap-2">
            <span class="text-xs text-amber-600 dark:text-amber-400 font-medium">Beta</span>
            <button
              @click="!settingsLocked && (multiViewEnabled = !multiViewEnabled)"
              class="relative w-10 h-5 rounded-full transition-colors"
              :class="multiViewEnabled ? 'bg-brand-dark dark:bg-brand-teal' : 'bg-gray-300 dark:bg-gray-600'"
            >
              <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                :class="multiViewEnabled ? 'translate-x-5' : ''"
              ></span>
            </button>
          </div>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Upload additional views of your object for improved 3D accuracy.
        </p>
        <div v-if="multiViewEnabled" class="grid grid-cols-3 gap-3">
          <div
            v-for="(_, idx) in 3"
            :key="idx"
            class="aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center relative overflow-hidden cursor-pointer hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
            @click="!settingsLocked && multiViewInputs[idx]?.click()"
          >
            <input
              type="file"
              :ref="el => multiViewInputs[idx] = el"
              class="hidden"
              accept="image/png, image/jpeg"
              @change="handleMultiViewSelect(idx, $event)"
            />
            <template v-if="multiViewPreviews[idx]">
              <img :src="multiViewPreviews[idx]" class="w-full h-full object-cover" />
              <button
                @click.stop="!settingsLocked && removeMultiView(idx)"
                class="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs hover:bg-red-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </template>
            <template v-else>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              <span class="text-[10px] text-gray-400 mt-1">View {{ idx + 1 }}</span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent Models History -->
    <div v-if="historyStore.items.length > 0" class="w-full max-w-2xl mt-12">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-display text-xl font-bold text-brand-dark dark:text-white transition-colors duration-300">Recent Models</h2>
        <button
          @click="store.openSimulation"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 text-brand-dark dark:text-gray-100 text-xs font-semibold hover:border-brand-dark dark:hover:border-brand-teal hover:text-brand-dark dark:hover:text-brand-teal transition-colors"
        >
          <span>3D Print Simulation</span>
          <span class="text-[10px] text-gray-400">STL</span>
        </button>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <!-- In-Progress Card (priority display) -->
        <div
          v-for="item in inProgressItems"
          :key="item.jobId"
          @click="store.resumeBackgroundJob()"
          class="group cursor-pointer rounded-xl border-2 border-brand-dark dark:border-brand-teal bg-white dark:bg-gray-800 overflow-hidden hover:shadow-lg hover:shadow-brand-dark/20 dark:hover:shadow-brand-teal/20 transition-all duration-200"
        >
          <div class="aspect-square bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
            <!-- Circular Progress -->
            <div class="w-20 h-20 relative mb-4">
              <svg class="w-full h-full transform -rotate-90">
                <circle cx="40" cy="40" r="36" stroke="currentColor" stroke-width="4" fill="none" class="text-gray-200 dark:text-gray-700" />
                <circle
                  cx="40" cy="40" r="36"
                  stroke="currentColor" stroke-width="4" fill="none"
                  class="text-brand-dark dark:text-brand-teal transition-all duration-500"
                  :stroke-dasharray="`${getItemProgress(item) * 2.26} 226`"
                />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center">
                <span class="text-lg font-bold text-brand-dark dark:text-white">{{ getItemProgress(item) }}%</span>
              </div>
            </div>

            <!-- Status Text -->
            <p class="text-xs font-mono text-brand-dark dark:text-brand-teal font-semibold uppercase">
              {{ formatOperationType(item) }}
            </p>
            <p class="text-[10px] text-gray-500 mt-1" :data-tick="etaTick">
              {{ formatEta(item) }}
            </p>
          </div>

          <div class="p-3 bg-white/50 dark:bg-gray-800/50">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-brand-dark dark:text-white">In Progress</p>
              <span class="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-brand-dark/10 text-brand-dark border border-brand-dark/30 dark:bg-brand-teal/10 dark:text-brand-teal dark:border-brand-teal/30">ACTIVE</span>
            </div>
            <p class="text-xs text-gray-500 mt-1">Click to resume</p>
          </div>
        </div>

        <!-- Completed Models -->
        <div
          v-for="item in completedItems"
          :key="item.jobId"
          @click="store.loadFromHistory(item.jobId, { qualityPreset: item.qualityPreset })"
          class="group cursor-pointer rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden hover:border-brand-dark dark:hover:border-brand-teal transition-all duration-200 hover:shadow-lg hover:shadow-gray-500/10 dark:hover:shadow-teal-500/10"
        >
          <div class="aspect-square bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
            <!-- Show loading spinner while thumbnail is loading -->
            <div v-if="!item.thumbnailBlobUrl" class="absolute inset-0 flex items-center justify-center">
              <div class="w-8 h-8 border-2 border-brand-teal border-t-transparent rounded-full animate-spin"></div>
            </div>
            <img
              v-if="item.thumbnailBlobUrl"
              :src="item.thumbnailBlobUrl"
              :alt="item.name"
              class="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
            <button
              @click.stop="deleteModel(item.jobId)"
              class="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500/80 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              title="Delete model"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          <div class="p-3">
            <div class="flex justify-between items-start">
              <p class="text-sm font-medium text-brand-dark dark:text-white truncate flex-1">{{ item.name }}</p>
              <div class="flex gap-1 ml-2">
                <span v-if="item.qualityPreset"
                      class="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded border"
                      :class="{
                        'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800': item.qualityPreset === 'v1',
                        'bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800': item.qualityPreset === 'v2',
                        'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800': item.qualityPreset === 'v3',
                        'bg-gray-50 text-gray-700 border-gray-300 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800': !['v1','v2','v3'].includes(item.qualityPreset)
                      }">
                  {{ item.qualityPreset }}
                </span>
                <span v-if="item.deprecated || item.modelVersion === 'v2.0'"
                      class="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-300 dark:border-red-800">
                  DEPRECATED
                </span>
                <span v-else-if="item.modelVersion" class="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                  {{ item.modelVersion }}
                </span>
              </div>
            </div>
            <p class="text-xs text-gray-400 font-mono mt-1">{{ new Date(item.createdAt).toLocaleDateString() }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Dropzone content swap */
.dropzone-enter-active,
.dropzone-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.dropzone-enter-from {
  opacity: 0;
  transform: scale(0.95);
}
.dropzone-leave-to {
  opacity: 0;
  transform: scale(1.02);
}

/* Fade for overlays */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Fade + slide for action buttons */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
