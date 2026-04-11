import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS is required for Web Bluetooth on non-localhost origins. Self-signed
// cert is regenerated on first run; phone will warn once, then pairing works.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    https: true,
    proxy: {
      '/ws':  { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8000', rewrite: p => p.replace(/^\/api/, '') },
    },
  },
})
