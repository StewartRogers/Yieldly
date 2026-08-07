import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

// package.json sets "type": "module", so __dirname is not a real binding here —
// it only worked because Vite shims it when bundling the config.
const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  server: {
    port: 2080,
    proxy: {
      '/api': 'http://localhost:2085',
    },
  },
})
