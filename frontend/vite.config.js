import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL || 'http://localhost:8077'

  return {
    plugins: [vue(templateCompilerOptions)],
    server: {
      host: true, // Listen on all local IPs
      port: 5177, // Custom port
      hmr: {
        // Fix WebSocket connection for multiple network interfaces
        host: 'localhost',
        protocol: 'ws',
        port: 5177,
      },
      proxy: {
        // Proxy fallback: only used when VITE_API_URL is empty (same device dev)
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
