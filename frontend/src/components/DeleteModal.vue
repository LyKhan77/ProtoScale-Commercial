<script setup>
defineProps({
  show: Boolean,
});

defineEmits(['confirm', 'cancel']);
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
    <div
      class="group select-none w-[280px] flex flex-col p-4 relative items-center justify-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl rounded-2xl transform transition-all scale-100"
    >
      <div class="">
        <div class="text-center p-3 flex-auto justify-center">
          <svg
            fill="currentColor"
            viewBox="0 0 20 20"
            class="group-hover:animate-bounce w-12 h-12 flex items-center text-gray-400 dark:text-gray-500 fill-red-500 mx-auto"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              clip-rule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              fill-rule="evenodd"
            ></path>
          </svg>
          <h2 class="text-xl font-bold py-4 text-brand-dark dark:text-gray-200 transition-colors">Are you sure?</h2>
          <p class="font-bold text-sm text-gray-500 px-2">
            Do you really want to continue? This process cannot be undone.
          </p>
        </div>
        <div class="p-2 mt-2 text-center space-x-2 flex justify-center">
          <button
            @click="$emit('cancel')"
            class="mb-2 md:mb-0 bg-gray-100 dark:bg-gray-700 px-5 py-2 text-sm shadow-sm font-medium tracking-wider border-2 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-600 dark:text-gray-300 rounded-full hover:shadow-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition ease-in duration-300"
          >
            Cancel
          </button>
          <button
            @click="$emit('confirm')"
            class="bg-red-500 hover:bg-transparent px-5 py-2 text-sm shadow-sm hover:shadow-lg font-medium tracking-wider border-2 border-red-500 hover:border-red-500 text-white hover:text-red-500 rounded-full transition ease-in duration-300"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
