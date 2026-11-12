import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // electron-store is ESM-only; bundle it into the CommonJS main build.
      externalizeDeps: { exclude: ['electron-store'] }
    }
  },
  preload: {
    build: {
      // A sandboxed preload cannot require node_modules, so nothing is external.
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
