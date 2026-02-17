<script setup>
import { ref, onMounted } from 'vue';
import { useToastStore } from '../stores/toast';

const toastStore = useToastStore();

function handleAction(toast) {
  if (toast.action && toast.action.onClick) {
    toast.action.onClick();
  }
  toastStore.removeToast(toast.id);
}
</script>

<template>
  <div class="fixed top-4 right-4 z-[200] flex flex-col gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toastStore.toasts"
        :key="toast.id"
        class="max-w-sm bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-4 animate-slide-in"
      >
        <div class="flex items-start gap-3">
          <!-- Icon -->
          <svg v-if="toast.type === 'success'" class="w-5 h-5 text-green-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <svg v-else-if="toast.type === 'error'" class="w-5 h-5 text-red-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <svg v-else class="w-5 h-5 text-blue-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>

          <!-- Content -->
          <div class="flex-1">
            <p class="font-bold text-brand-dark dark:text-white text-sm">{{ toast.title }}</p>
            <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">{{ toast.message }}</p>

            <!-- Action Button -->
            <button
              v-if="toast.action"
              @click="handleAction(toast)"
              class="mt-2 px-3 py-1 text-xs font-bold rounded bg-brand-dark dark:bg-brand-teal text-white hover:opacity-90 transition-opacity"
            >
              {{ toast.action.label }}
            </button>
          </div>

          <!-- Close Button -->
          <button
            @click="toastStore.removeToast(toast.id)"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100px);
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(100px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.animate-slide-in {
  animation: slide-in 0.3s ease;
}
</style>
