  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  // https://vitejs.dev/config/
  export default defineConfig({
    plugins: [react()],
    server: {
      port: 3000,
      strictPort: false,
      // Proxy all /api/* and /accounts/* requests to Django
      // so we don't have to deal with CORS in development
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/accounts': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/watcher': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/media': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  })
