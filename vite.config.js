import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
  ],

  build: {
    sourcemap: false,

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf('node_modules') === -1) {
            return
          }

          if (
            id.indexOf('/recharts/') !== -1
            || id.indexOf('/d3-') !== -1
          ) {
            return 'charts'
          }

          if (id.indexOf('/xlsx/') !== -1) {
            return 'xlsx'
          }

          if (
            id.indexOf('/react/') !== -1
            || id.indexOf('/react-dom/') !== -1
          ) {
            return 'react'
          }

          if (
            id.indexOf('/lucide-react/') !== -1
          ) {
            return 'icons'
          }
        },
      },
    },
  },
})
