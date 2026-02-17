<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'

const authStore = useAuthStore()
const themeStore = useThemeStore()

const username = ref('')
const password = ref('')
const error = ref('')
const isLoading = ref(false)
const showPassword = ref(false)

async function handleLogin() {
  error.value = ''
  isLoading.value = true

  // Simulate async delay for UX
  await new Promise(resolve => setTimeout(resolve, 300))

  const result = authStore.login(username.value, password.value)

  isLoading.value = false

  if (!result.success) {
    error.value = result.error
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-gray-50 dark:bg-gray-950 transition-colors duration-300">
    <!-- Login Card -->
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <img
          v-if="!themeStore.isDark"
          src="/logoProtoScale-LightTheme.png"
          alt="ProtoScale"
          class="h-16 mx-auto mb-4"
        />
        <img
          v-else
          src="/logoProtoScale-DarkTheme.png"
          alt="ProtoScale"
          class="h-16 mx-auto mb-4"
        />
        <h1 class="text-2xl font-display font-bold text-gray-800 dark:text-gray-100">
          Welcome to ProtoScale
        </h1>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-2">
          Sign in to continue to your 3D generation workspace
        </p>
      </div>

      <!-- Login Form Card -->
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-8 transition-colors duration-300">
        <form @submit.prevent="handleLogin" class="space-y-6">
          <!-- Error Message -->
          <div
            v-if="error"
            class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm"
          >
            {{ error }}
          </div>

          <!-- Username Input -->
          <div>
            <label
              for="username"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Username
            </label>
            <input
              id="username"
              v-model="username"
              type="text"
              required
              autocomplete="username"
              class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-3 focus:ring-2 focus:ring-brand-dark dark:focus:ring-brand-teal focus:border-transparent outline-none transition-colors"
              placeholder="Enter username"
            />
          </div>

          <!-- Password Input -->
          <div>
            <label
              for="password"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Password
            </label>
            <div class="relative">
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                required
                autocomplete="current-password"
                class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-3 pr-12 focus:ring-2 focus:ring-brand-dark dark:focus:ring-brand-teal focus:border-transparent outline-none transition-colors"
                placeholder="Enter password"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg v-if="!showPassword" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Login Button -->
          <button
            type="submit"
            :disabled="isLoading"
            class="w-full bg-brand-dark dark:bg-brand-teal text-white px-8 py-3 rounded-lg font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-gray-500/30 dark:shadow-teal-500/30 transition-all duration-200"
          >
            <span v-if="!isLoading">Sign In</span>
            <span v-else class="flex items-center justify-center">
              <svg class="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Signing in...
            </span>
          </button>
        </form>
      </div>

      <!-- Footer -->
      <div class="text-center mt-6 text-xs text-gray-500 dark:text-gray-400">
        ProtoScale-AI © 2026 • AI-Powered 3D Model Generation
      </div>
    </div>
  </div>
</template>
