import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this as a project site under /forex-price-simulator/,
// so production asset URLs need that base — but local dev must stay at '/'
// or `npm run dev` breaks.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/forex-price-simulator/' : '/',
  server: {
    port: 5173,
  },
}))
