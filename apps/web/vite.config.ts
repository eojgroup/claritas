import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In development, proxy API requests to the local API server (apps/api runs on 8080)
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        // Preserve the original host so OAuth redirect URIs stay on the Vite origin.
        changeOrigin: false,
        secure: false,
        xfwd: true,
      },
    },
  },
})
