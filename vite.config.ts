import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages repository sites are served from /<repo-name>/.
  base: process.env.VITE_BASE_PATH ?? '/',
})
