import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([]);
  let toastId = 0;

  function showToast({ type = 'info', title, message, duration = 5000, action = null }) {
    const id = ++toastId;
    const toast = { id, type, title, message, action, visible: true };

    toasts.value.push(toast);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  }

  function removeToast(id) {
    const index = toasts.value.findIndex(t => t.id === id);
    if (index >= 0) {
      toasts.value.splice(index, 1);
    }
  }

  return { toasts, showToast, removeToast };
});
