import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Keep the browser's Host header: the API checks it against Origin and builds sign-in callback URLs from it.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
})
