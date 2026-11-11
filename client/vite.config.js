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
  // Read env from the repo-root .env (same file as the server), and expose only
  // APP_TIMEZONE / APP_TIMEZONE_LABEL besides VITE_* (see src/utils/time.js).
  // Secrets in that file (SESSION_SECRET, TURSO_*, …) match neither prefix
  // and stay out of the bundle. Vercel's build env is picked up the same way.
  envDir: path.resolve(dirname, '..'),
  envPrefix: ['VITE_', 'APP_TIMEZONE'],
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
