<script setup>
import { onMounted, onUnmounted, computed, ref } from 'vue';
import { useProcessStore } from '../stores/process';
import { useThemeStore } from '../stores/theme';

const store = useProcessStore();
const theme = useThemeStore();
const now = ref(Date.now());
let nowInterval = null;

// Dynamic Loader Colors
const loaderColors = computed(() => {
  if (theme.isDark) {
    // Dark Mode: Teal Palette
    return {
      left: '#007C85',  // Darker Shadow
      right: '#00AFB9', // Base Color
      top: '#33BFC7'    // Lighter Highlight
    };
  } else {
    // Light Mode: Dark Gray Palette
    return {
      left: '#2E2828',  // Darker Shadow
      right: '#453D3D', // Base Color
      top: '#756A6A'    // Lighter Highlight
    };
  }
});

const totalSeconds = computed(() => {
  const preset = store.MODEL_PRESETS[store.selectedPreset];
  const str = preset ? preset.estimatedTime : '2-3 min';
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1]) * 60 : 180;
});

const displayStage = computed(() => store.uiStage || store.stage);

const timeProgress = computed(() => {
  if (store.progress >= 100) return 100;
  // Use actual progress from backend, cap at 95% until completion
  return Math.min(95, store.progress);
});

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min > 0) return `${min}m ${rem}s`;
  return `${rem}s`;
}

const etaText = computed(() => {
  if (displayStage.value === 'completed') return 'Done';
  if (store.jobStatus === 'completed' || store.progress >= 100) return 'Almost done...';
  if (!store.jobStartedAt) return 'Calculating...';

  const elapsed = Math.max(0, Math.floor((now.value - store.jobStartedAt) / 1000));
  const remaining = Math.max(0, totalSeconds.value - elapsed);

  // Before estimated time: show countdown
  // After estimated time exceeded: show elapsed
  if (remaining <= 0) {
    return `${formatDuration(elapsed)} elapsed`;
  }
  return `~${formatDuration(remaining)} ETA`;
});

const progressLabel = computed(() => {
  if (store.jobStatus === 'failed') return 'FAILED';
  if (displayStage.value === 'completed' || (!displayStage.value && (store.jobStatus === 'completed' || store.progress >= 100))) return 'COMPLETED';
  if (store.jobStatus === 'queued' && (displayStage.value === 'ready' || !displayStage.value)) return 'WAITING TO START';

  // Backend stages mapping
  if (displayStage.value === 'upload') {
    if (store.jobStatus === 'queued' || store.jobStatus === 'ready') {
      return 'WAITING TO START';
    }
    return 'INITIALIZING';
  }
  if (displayStage.value === 'ready') return 'READY TO GENERATE';
  if (displayStage.value === 'rembg') return 'REMOVING BACKGROUND';
  if (displayStage.value === 'geometry') return 'GENERATING 3D MODEL';
  if (displayStage.value === 'postprocess') return 'FINALIZING';

  // Legacy fallback
  if (displayStage.value === 'multiview') return 'GENERATING VIEWS';
  if (displayStage.value === '3d_generation') {
    if (store.progress < 30) return 'PREPARING MODEL';
    if (store.progress < 80) return 'GENERATING GEOMETRY';
    return 'APPLYING TEXTURE';
  }

  // Progress-based fallback when stage is null/undefined
  const p = store.progress;
  if (p >= 98) return 'FINALIZING';
  if (p >= 82) return 'APPLYING TEXTURE';
  if (p >= 30) return 'GENERATING GEOMETRY';
  if (p >= 5) return 'REMOVING BACKGROUND';

  return 'INITIALIZING';
});

onMounted(() => {
  nowInterval = setInterval(() => {
    now.value = Date.now();
  }, 1000);

  // Guard: No jobId means nothing to process
  if (!store.jobId) {
    return;
  }

  (async () => {
    await store.syncStatus(store.jobId);

    if (store.jobStatus === 'completed' || store.jobStatus === 'failed') {
      return;
    }

    // If backend says it's already running, resume polling.
    if (store.jobStatus === 'queued' || store.jobStatus === 'processing') {
      store.isProcessing = true;
      store.startPolling(store.jobId);
      return;
    }

    // If we're already processing locally, ensure polling.
    if (store.isProcessing) {
      store.startPolling(store.jobId);
      return;
    }

    // Fresh start: trigger generation.
    store.generate3D();
  })();
});

onUnmounted(() => {
  if (nowInterval) {
    clearInterval(nowInterval);
    nowInterval = null;
  }
});

// Retry generation - keep same job/image but trigger new generation
function retryGeneration() {
  if (!store.jobId) {
    store.reset();
    return;
  }
  // Clear error and retry
  store.error = null;
  store.generate3D();
}

function handleStartOver() {
  // If background operation is running, just navigate to Upload without resetting
  if (store.backgroundOperation.type !== null) {
    store.currentStepIndex = 0;
    return;
  }
  store.reset();
}
</script>

<template>
  <div class="flex flex-col h-full animate-fade-in">
    <div class="text-center mb-6">
      <h1 class="font-display text-2xl font-bold text-brand-dark dark:text-white transition-colors duration-300">Generating 3D Model</h1>
      <p class="text-gray-500 dark:text-gray-400 text-sm transition-colors duration-300">Reconstructing geometry from your image. This may take a moment.</p>
    </div>

    <!-- Loading State -->
    <div class="flex-1 flex flex-col items-center justify-center min-h-[400px]">

      <!-- Custom 3D Tower Loader -->
      <div class="loader mb-12">
        <div class="box box-1">
          <div class="side-left"></div>
          <div class="side-right"></div>
          <div class="side-top"></div>
        </div>
        <div class="box box-2">
          <div class="side-left"></div>
          <div class="side-right"></div>
          <div class="side-top"></div>
        </div>
        <div class="box box-3">
          <div class="side-left"></div>
          <div class="side-right"></div>
          <div class="side-top"></div>
        </div>
        <div class="box box-4">
          <div class="side-left"></div>
          <div class="side-right"></div>
          <div class="side-top"></div>
        </div>
      </div>

      <span class="font-mono text-sm text-brand-dark dark:text-brand-teal font-semibold tracking-wide">
        {{ progressLabel }}
      </span>
      <div class="w-64 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-3">
        <div
          class="h-full bg-brand-dark dark:bg-brand-teal rounded-full transition-all duration-1000 ease-linear"
          :style="{ width: timeProgress + '%' }"
        ></div>
      </div>
      <span class="font-mono text-xs text-gray-400 dark:text-gray-500 mt-2">
        {{ etaText }}
      </span>

      <!-- Error State -->
      <div v-if="store.error" class="mt-8 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm max-w-md text-center">
        <p class="font-medium mb-2">Generation Failed</p>
        <p>{{ store.error }}</p>
        <div class="mt-4 flex gap-3 justify-center">
          <button
            @click="retryGeneration"
            class="px-6 py-2 rounded-lg bg-red-600 dark:bg-red-700 text-white hover:bg-red-700 dark:hover:bg-red-800 font-medium transition-colors text-sm"
          >
            Try Again
          </button>
          <button
            @click="handleStartOver"
            class="px-6 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 font-medium transition-colors text-sm"
          >
            Start Over
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  /* 3D tower loader made by: csozi | Website: www.csozi.hu */

  .loader {
    scale: 2;
    height: 50px;
    width: 40px;
  }

  .box {
    position: relative;
    opacity: 0;
    left: 10px;
  }

  .side-left {
    position: absolute;
    background-color: v-bind('loaderColors.left');
    width: 19px;
    height: 5px;
    transform: skew(0deg, -25deg);
    top: 14px;
    left: 10px;
    transition: background-color 0.3s ease;
  }

  .side-right {
    position: absolute;
    background-color: v-bind('loaderColors.right');
    width: 19px;
    height: 5px;
    transform: skew(0deg, 25deg);
    top: 14px;
    left: -9px;
    transition: background-color 0.3s ease;
  }

  .side-top {
    position: absolute;
    background-color: v-bind('loaderColors.top');
    width: 20px;
    height: 20px;
    rotate: 45deg;
    transform: skew(-20deg, -20deg);
    transition: background-color 0.3s ease;
  }

  .box-1 {
    animation: from-left 4s infinite;
  }

  .box-2 {
    animation: from-right 4s infinite;
    animation-delay: 1s;
  }

  .box-3 {
    animation: from-left 4s infinite;
    animation-delay: 2s;
  }

  .box-4 {
    animation: from-right 4s infinite;
    animation-delay: 3s;
  }

  @keyframes from-left {
    0% {
      z-index: 20;
      opacity: 0;
      translate: -20px -6px;
    }

    20% {
      z-index: 10;
      opacity: 1;
      translate: 0px 0px;
    }

    40% {
      z-index: 9;
      translate: 0px 4px;
    }

    60% {
      z-index: 8;
      translate: 0px 8px;
    }

    80% {
      z-index: 7;
      opacity: 1;
      translate: 0px 12px;
    }

    100% {
      z-index: 5;
      translate: 0px 30px;
      opacity: 0;
    }
  }

  @keyframes from-right {
    0% {
      z-index: 20;
      opacity: 0;
      translate: 20px -6px;
    }

    20% {
      z-index: 10;
      opacity: 1;
      translate: 0px 0px;
    }

    40% {
      z-index: 9;
      translate: 0px 4px;
    }

    60% {
      z-index: 8;
      translate: 0px 8px;
    }

    80% {
      z-index: 7;
      opacity: 1;
      translate: 0px 12px;
    }

    100% {
      z-index: 5;
      translate: 0px 30px;
      opacity: 0;
    }
  }
</style>
