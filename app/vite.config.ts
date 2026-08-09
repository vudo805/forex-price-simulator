import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this as a project site under /forex-price-simulator/,
// so production asset URLs need that base — but local dev must stay at '/' or
// `npm run dev` breaks. `command` alone can't tell these apart: `vite preview`
// also reports command 'serve' (same as `vite dev`) — it's `mode` that differs
// ('production' for both build and preview, 'development' for dev).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/forex-price-simulator/' : '/',
  server: {
    port: 5173,
  },
}))
