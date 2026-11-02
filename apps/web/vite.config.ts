import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Transform world-countries' legacy JSON import syntax for current Node.
  test: { server: { deps: { inline: ['world-countries'] } } },
  plugins: [react(), {
    name: 'claritas-country-reference',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/world-countries/countries.json')) return
      // All client consumers use only this reference subset. The source
      // package also includes translations, demonyms and other large fields;
      // omit them at build time, before downloading and parsing in the browser.
      const countries = JSON.parse(code) as Array<{
        cca2: string; ccn3: string; latlng: number[]; region: string; subregion: string;
        name: { common: string; official: string };
      }>
      return JSON.stringify(countries.map(({ cca2, ccn3, latlng, region, subregion, name }) => ({
        cca2, ccn3, latlng, region, subregion, name: { common: name.common, official: name.official },
      })))
    },
  }],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // The detailed atlas belongs to lazy event/transport workspaces.
          // Bundling both atlases together made World overview preload it too.
          if (id.includes('/world-atlas/countries-50m')) return 'detailed-geography'
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
