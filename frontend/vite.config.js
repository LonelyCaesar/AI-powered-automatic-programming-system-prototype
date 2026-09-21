import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backendTarget = 'http://localhost:8000'

function configureBackendProxy(proxy) {
  proxy.on('error', (error, req, res) => {
    const code = error?.code || 'PROXY_ERROR'
    const url = req?.url || ''
    if (['ECONNABORTED', 'ECONNRESET'].includes(code)) {
      console.warn(`[vite proxy] ${code} ${url} - backend websocket disconnected; waiting for reconnect`)
      return
    }
    console.error(`[vite proxy] ${code} ${url}`, error)
    if (res?.writeHead && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Backend proxy error')
    }
  })
}

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco'
          if (id.includes('@xterm')) return 'terminal'
          if (id.includes('chart.js') || id.includes('vue-chartjs')) return 'charts'
          if (id.includes('node_modules')) return 'vendor'
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': { target: backendTarget, configure: configureBackendProxy },
      '/socket.io': { target: backendTarget, ws: true, configure: configureBackendProxy },
      '/sandbox': { target: backendTarget, ws: true, configure: configureBackendProxy }
    }
  }
})
