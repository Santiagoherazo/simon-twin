import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Separa three y mqtt para que el HUD cargue rápido y se cachee mejor
        manualChunks: {
          three: ['three'],
          mqtt: ['mqtt'],
        },
      },
    },
  },
})
