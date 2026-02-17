<script setup>
import { computed } from 'vue';
import { useProcessStore } from './stores/process';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';
import AppHeader from './components/AppHeader.vue';
import ProcessStepper from './components/ProcessStepper.vue';
import GravityStars from './components/GravityStars.vue';
import Toast from './components/Toast.vue';
import UploadView from './views/UploadView.vue';
import ProgressView from './views/ProgressView.vue';
import PreviewView from './views/PreviewView.vue';
import ExportView from './views/ExportView.vue';
import SimulationView from './views/SimulationView.vue';
import LoginView from './views/LoginView.vue';

const store = useProcessStore();
const authStore = useAuthStore();
const theme = useThemeStore(); // Initialize theme

// Check auth on mount
authStore.checkAuth();

const currentView = computed(() => {
  // Check authentication first
  if (!authStore.isAuthenticated) {
    return LoginView;
  }

  // Existing view logic
  switch (store.currentStepIndex) {
    case 0: return UploadView;
    case 1: return ProgressView;
    case 2: return PreviewView;
    case 3: return ExportView;
    default: return UploadView;
  }
});
</script>

<template>
  <div class="min-h-screen bg-brand-white dark:bg-gray-950 text-brand-dark dark:text-gray-100 font-sans selection:bg-brand-teal selection:text-white flex flex-col transition-colors duration-300 relative overflow-hidden">
    <!-- Background Effect -->
    <GravityStars />

    <!-- Show header only when authenticated -->
    <AppHeader v-if="authStore.isAuthenticated" class="relative z-10" />

    <main class="flex-1 flex flex-col relative z-10">
      <!-- Show stepper only when authenticated and not in simulation -->
      <ProcessStepper v-if="authStore.isAuthenticated && !store.isSimulationOpen" />

      <div class="flex-1 relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Transition
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="transform opacity-0 translate-y-4"
          enter-to-class="transform opacity-100 translate-y-0"
          leave-active-class="transition duration-200 ease-in"
          leave-from-class="transform opacity-100 translate-y-0"
          leave-to-class="transform opacity-0 -translate-y-4"
          mode="out-in"
        >
          <SimulationView v-if="authStore.isAuthenticated && store.isSimulationOpen" />
          <component v-else :is="currentView" />
        </Transition>
      </div>
    </main>

    <footer v-if="authStore.isAuthenticated" class="py-6 text-center text-xs text-gray-400 dark:text-gray-600 font-mono border-t border-gray-100 dark:border-gray-800 transition-colors duration-300 relative z-10">
      PROTOSCALE SYSTEMS v0.1.0-ALPHA • LOCAL COMPUTE NODE
    </footer>

    <!-- Toast Notifications -->
    <Toast />
  </div>
</template>
