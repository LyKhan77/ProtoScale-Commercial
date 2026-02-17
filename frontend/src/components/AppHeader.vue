<script setup>
import { computed } from 'vue';
import { useProcessStore } from '../stores/process';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';
import ThemeToggle from './ThemeToggle.vue';

const store = useProcessStore();
const authStore = useAuthStore();
const theme = useThemeStore();

const logoSrc = computed(() => {
  return theme.isDark ? '/logoProtoScale-DarkTheme.png' : '/logoProtoScale-LightTheme.png';
});

// Disable logout when any job is actively processing
const isJobActive = computed(() =>
  store.isProcessing ||
  store.isRetexturing ||
  store.backgroundOperation.type !== null
);

function handleLogoClick() {
  // Close simulation if open
  if (store.isSimulationOpen) {
    store.closeSimulation();
  }

  // If any foreground operation is active, move to background first
  if (store.isProcessing || store.isRetexturing) {
    store.continueInBackground();
    return;
  }

  // If background operation exists, just navigate to Upload
  if (store.backgroundOperation.type !== null) {
    store.currentStepIndex = 0;
    return;
  }

  // No operations - reset to fresh state
  store.reset();
}

function handleLogout() {
  // Block logout if any job is active
  if (isJobActive.value) return;

  authStore.logout();
  store.reset();
}
</script>

<template>
  <header class="w-full h-20 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-8 bg-transparent sticky top-0 z-50 transition-colors duration-300">
    <div
      class="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-opacity"
      @click="handleLogoClick"
    >
      <img :src="logoSrc" alt="ProtoScale" class="h-12 w-auto" />
    </div>

    <div class="flex items-center gap-4">
      <!-- User info -->
      <div class="hidden sm:block text-sm text-gray-600 dark:text-gray-400 mr-2">
        {{ authStore.username }}
      </div>

      <!-- Logout button -->
      <button
        @click="handleLogout"
        :disabled="isJobActive"
        class="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-colors"
        :class="isJobActive ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-200 dark:hover:bg-gray-700'"
        :title="isJobActive ? 'Cannot logout while a job is processing' : 'Logout'"
      >
        <svg class="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      <ThemeToggle />
    </div>
  </header>
</template>
