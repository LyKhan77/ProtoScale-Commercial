<script setup>
import { ref, computed, onMounted } from 'vue';
import { useProcessStore } from '../stores/process';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import Loader3D from '../components/Loader3D.vue';

const store = useProcessStore();
const isExporting = ref(false);
const isLoading = ref(true);

// Unit conversion: internal units to millimeters
const UNIT_TO_MM = 10;

onMounted(() => {
  // Simulate processing/preparation time
  setTimeout(() => {
    isLoading.value = false;
  }, 3000);
});

async function loadGLBForExport() {
  if (!store.modelUrl) {
    throw new Error('No model URL available');
  }

  // Use cached scene from PreviewView if available
  if (store.modelScene) {
    console.log('=== Using cached scene for Export ===');
    return store.modelScene.clone();
  }

  console.log('=== Loading GLB for Export (fallback fetch) ===');

  return new Promise((resolve, reject) => {
    // Fetch with custom headers for ngrok/proxy compatibility
    fetch(store.modelUrl, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
      },
      credentials: 'include',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const loader = new GLTFLoader();
        loader.load(
          blobUrl,
          (gltf) => {
            console.log('GLB loaded for export');
            URL.revokeObjectURL(blobUrl);
            resolve(gltf.scene);
          },
          undefined,
          (error) => {
            console.error('Failed to load GLB for export:', error);
            URL.revokeObjectURL(blobUrl);
            reject(error);
          }
        );
      })
      .catch(err => {
        console.error('Failed to fetch GLB:', err);
        reject(err);
      });
  });
}

async function downloadSTL() {
  isExporting.value = true;

  try {
    console.log('=== STL Export Started ===');
    
    // Reload GLB
    const scene = await loadGLBForExport();
    
    // Apply scale with unit conversion (internal units to mm)
    scene.scale.set(
      store.userScale.x * UNIT_TO_MM,
      store.userScale.y * UNIT_TO_MM,
      store.userScale.z * UNIT_TO_MM
    );
    scene.updateMatrixWorld(true);

    // Export to STL
    const exporter = new STLExporter();
    const result = exporter.parse(scene, { binary: true });
    
    if (!result || result.byteLength === 0) {
      throw new Error('Export failed: No geometry data generated');
    }

    console.log(`STL export successful: ${result.byteLength} bytes`);
    const blob = new Blob([result], { type: 'application/octet-stream' });
    triggerDownload(blob, 'model.stl');
  } catch (error) {
    console.error('STL export failed:', error);
    alert(`STL Export failed: ${error.message}`);
  } finally {
    isExporting.value = false;
  }
}

async function downloadOBJ() {
  isExporting.value = true;

  try {
    console.log('=== OBJ Export Started ===');
    
    // Reload GLB
    const scene = await loadGLBForExport();
    
    // Apply scale with unit conversion (internal units to mm)
    scene.scale.set(
      store.userScale.x * UNIT_TO_MM,
      store.userScale.y * UNIT_TO_MM,
      store.userScale.z * UNIT_TO_MM
    );
    scene.updateMatrixWorld(true);

    // Export to OBJ
    const exporter = new OBJExporter();
    const result = exporter.parse(scene);
    
    if (!result || result.trim().length === 0) {
      throw new Error('Export failed: No geometry data generated');
    }

    console.log(`OBJ export successful: ${result.length} characters`);
    const blob = new Blob([result], { type: 'text/plain' });
    triggerDownload(blob, 'model.obj');
  } catch (error) {
    console.error('OBJ export failed:', error);
    alert(`OBJ Export failed: ${error.message}`);
  } finally {
    isExporting.value = false;
  }
}

async function downloadGLB() {
  isExporting.value = true;

  try {
    console.log('=== GLB Export Started ===');
    
    // Reload GLB
    const scene = await loadGLBForExport();
    
    // Apply scale with unit conversion (internal units to mm)
    scene.scale.set(
      store.userScale.x * UNIT_TO_MM,
      store.userScale.y * UNIT_TO_MM,
      store.userScale.z * UNIT_TO_MM
    );
    scene.updateMatrixWorld(true);

    // Export to GLB
    const exporter = new GLTFExporter();
    
    exporter.parse(
      scene,
      (result) => {
        let blob, filename;
        
        if (result instanceof ArrayBuffer) {
          blob = new Blob([result], { type: 'application/octet-stream' });
          filename = 'model.glb';
          console.log(`GLB export successful: ${result.byteLength} bytes`);
        } else {
          blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
          filename = 'model.gltf';
          console.log(`GLTF export successful`);
        }
        
        triggerDownload(blob, filename);
        isExporting.value = false;
      },
      (error) => {
        console.error('GLB export error:', error);
        alert(`GLB Export failed: ${error.message}`);
        isExporting.value = false;
      },
      { binary: true }
    );
  } catch (error) {
    console.error('GLB export failed:', error);
    alert(`GLB Export failed: ${error.message}`);
    isExporting.value = false;
  }
}

const exportDimensions = computed(() => {
  if (!store.bboxSize || store.bboxSize.x === 0) return null;

  const s = store.userScale;
  return {
    x: (store.bboxSize.x * s.x * UNIT_TO_MM).toFixed(1),
    y: (store.bboxSize.y * s.y * UNIT_TO_MM).toFixed(1),
    z: (store.bboxSize.z * s.z * UNIT_TO_MM).toFixed(1),
  };
});

const hasCustomScale = computed(() => {
  return store.userScale.x !== 1 || 
         store.userScale.y !== 1 || 
         store.userScale.z !== 1;
});

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function handleBackToHome() {
  // If any foreground operation is active, move to background first
  if (store.isProcessing || store.isRetexturing) {
    store.continueInBackground();
    return;
  }

  // If background operation exists, just navigate to Upload (don't reset)
  if (store.backgroundOperation.type !== null) {
    store.currentStepIndex = 0;
    return;
  }

  // No operations - reset to fresh state
  store.reset();
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in w-full">
    <Loader3D v-if="isLoading" />

    <div v-else class="flex flex-col items-center justify-center w-full animate-fade-in-up">
      <div class="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-6 text-green-600 dark:text-green-300 transition-colors duration-300">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    </div>

    <h1 class="font-display text-3xl font-bold mb-2 text-brand-dark dark:text-white transition-colors duration-300">Processing Complete</h1>
    <p class="text-gray-500 dark:text-gray-400 mb-8 text-center max-w-sm transition-colors duration-300">
      Your geometry is ready for manufacturing.
    </p>

    <!-- Export Dimensions Info -->
    <div v-if="exportDimensions" class="mb-8 w-full max-w-md animate-fade-in-up">
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors duration-300">
        <!-- Header -->
        <div class="bg-gray-50 dark:bg-gray-700/50 px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
          <h4 class="font-mono text-xs font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
            Final Export Dimensions
          </h4>
          <span class="text-[10px] font-mono bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">MM</span>
        </div>
        
        <!-- Grid Values -->
        <div class="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-700">
          <div class="p-4 text-center group hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            <div class="text-xs text-gray-400 dark:text-gray-500 mb-1 font-medium">Width (X)</div>
            <div class="font-display text-xl font-bold text-brand-dark dark:text-white group-hover:text-brand-teal transition-colors">
              {{ exportDimensions.x }}
            </div>
          </div>
          <div class="p-4 text-center group hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            <div class="text-xs text-gray-400 dark:text-gray-500 mb-1 font-medium">Height (Y)</div>
            <div class="font-display text-xl font-bold text-brand-dark dark:text-white group-hover:text-brand-teal transition-colors">
              {{ exportDimensions.y }}
            </div>
          </div>
          <div class="p-4 text-center group hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            <div class="text-xs text-gray-400 dark:text-gray-500 mb-1 font-medium">Depth (Z)</div>
            <div class="font-display text-xl font-bold text-brand-dark dark:text-white group-hover:text-brand-teal transition-colors">
              {{ exportDimensions.z }}
            </div>
          </div>
        </div>

        <!-- Scale Warning Footer -->
        <div v-if="hasCustomScale" class="bg-amber-50 dark:bg-amber-900/20 px-4 py-2 border-t border-amber-100 dark:border-amber-800/30 flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-xs font-medium text-amber-700 dark:text-amber-400">
            Custom scale applied ({{ store.userScale.x.toFixed(2) }}x)
          </span>
        </div>
      </div>
    </div>

    <!-- Exporting spinner -->
    <div v-if="isExporting" class="mb-4 flex items-center gap-2 text-brand-teal">
      <div class="w-4 h-4 border-2 border-brand-teal border-t-transparent rounded-full animate-spin"></div>
      <span class="font-mono text-sm">Exporting...</span>
    </div>

    <div class="grid gap-4 w-full max-w-md">
      <!-- STL Button -->
      <button
        @click="downloadSTL"
        :disabled="isExporting"
        class="flex items-center justify-between w-full p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-brand-dark dark:text-white rounded-xl hover:bg-brand-dark dark:hover:bg-brand-teal hover:text-white hover:border-transparent transition-all duration-200 group disabled:opacity-50"
      >
        <div class="flex items-center gap-3">
          <div class="bg-gray-100 dark:bg-gray-900 group-hover:bg-white/20 p-2 rounded-lg transition-colors duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-500 dark:text-gray-400 group-hover:text-white transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div class="text-left">
            <div class="font-bold">Download .STL</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-300 transition-colors duration-200">Binary format</div>
          </div>
        </div>
        <span class="opacity-0 group-hover:opacity-100 transition-opacity duration-200">→</span>
      </button>

      <!-- OBJ Button -->
      <button
        @click="downloadOBJ"
        :disabled="isExporting"
        class="flex items-center justify-between w-full p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-brand-dark dark:text-white rounded-xl hover:bg-brand-dark dark:hover:bg-brand-teal hover:text-white hover:border-transparent transition-all duration-200 group disabled:opacity-50"
      >
        <div class="flex items-center gap-3">
          <div class="bg-gray-100 dark:bg-gray-900 group-hover:bg-white/20 p-2 rounded-lg transition-colors duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-500 dark:text-gray-400 group-hover:text-white transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div class="text-left">
            <div class="font-bold">Download .OBJ</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-300 transition-colors duration-200">Source mesh</div>
          </div>
        </div>
        <span class="opacity-0 group-hover:opacity-100 transition-opacity duration-200">→</span>
      </button>

      <!-- GLB Button -->
      <button
        @click="downloadGLB"
        :disabled="isExporting"
        class="flex items-center justify-between w-full p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-brand-dark dark:text-white rounded-xl hover:bg-brand-dark dark:hover:bg-brand-teal hover:text-white hover:border-transparent transition-all duration-200 group disabled:opacity-50"
      >
        <div class="flex items-center gap-3">
          <div class="bg-gray-100 dark:bg-gray-900 group-hover:bg-white/20 p-2 rounded-lg transition-colors duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-gray-500 dark:text-gray-400 group-hover:text-white transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div class="text-left">
            <div class="font-bold">Download .GLB</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-300 transition-colors duration-200">glTF Binary</div>
          </div>
        </div>
        <span class="opacity-0 group-hover:opacity-100 transition-opacity duration-200">→</span>
      </button>
    </div>

    <button
      @click="store.currentStepIndex = 2"
      class="mt-6 font-medium text-brand-dark dark:text-brand-teal hover:text-gray-600 dark:hover:text-teal-400 transition-colors flex items-center gap-2"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      Adjust Scale / Back to Preview
    </button>

    <button
      @click="handleBackToHome"
      class="mt-8 text-sm text-gray-400 dark:text-gray-500 hover:text-brand-dark dark:hover:text-brand-teal transition-colors flex items-center gap-1"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
      Back to Home
    </button>
    </div>
  </div>
</template>
