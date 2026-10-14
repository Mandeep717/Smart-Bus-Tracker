import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = `http://127.0.0.1:${env.PORT || 5000}`

  return {
    publicDir: 'client/public',

    plugins: [
      react(),
      tailwindcss(),
    ],

    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,

      // Allow temporary Cloudflare Quick Tunnel hostnames
      allowedHosts: ['.trycloudflare.com'],

      // Forward API and Socket.IO requests to Express
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },

        '/socket.io': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})