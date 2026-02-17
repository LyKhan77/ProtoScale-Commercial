import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'protoscale_auth'
const VALID_CREDENTIALS = {
  username: 'protoscale-ai',
  password: 'Proto@Scale123'
}

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const username = ref('')

  function login(inputUsername, inputPassword) {
    if (inputUsername === VALID_CREDENTIALS.username &&
        inputPassword === VALID_CREDENTIALS.password) {
      isAuthenticated.value = true
      username.value = inputUsername
      saveToStorage()
      return { success: true }
    }
    return { success: false, error: 'Invalid username or password' }
  }

  function logout() {
    isAuthenticated.value = false
    username.value = ''
    localStorage.removeItem(STORAGE_KEY)
  }

  function checkAuth() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        if (data.isAuthenticated && data.username) {
          isAuthenticated.value = true
          username.value = data.username
        }
      }
    } catch (e) {
      console.error('Failed to load auth state:', e)
    }
  }

  function saveToStorage() {
    try {
      const data = {
        isAuthenticated: isAuthenticated.value,
        username: username.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('Failed to save auth state:', e)
    }
  }

  return {
    isAuthenticated,
    username,
    login,
    logout,
    checkAuth
  }
})
