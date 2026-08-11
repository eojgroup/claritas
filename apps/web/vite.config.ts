import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'visualization'
          if (id.includes('/topojson-') || id.includes('/world-atlas/')) return 'geospatial'
          if (id.includes('/lucide-react/')) return 'icons'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
          return 'vendor'
        },
      },
    },
  },
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
