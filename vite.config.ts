import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    watch: {
      ignored: ['**/.data/**', '**/archived/**', '**/dist/**', '**/docs/vendor/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/admin-api': 'http://127.0.0.1:3000',
      '/guest-api': 'http://127.0.0.1:3000',
      '/runtime-profile': 'http://127.0.0.1:3000',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
