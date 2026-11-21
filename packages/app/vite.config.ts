import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'ui-workbench',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/ui', async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/' && request.url?.split('?')[0] !== '') return next()
        const html = await server.transformIndexHtml('/__dev/ui', '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI 场景工作台</title></head><body><div id="root"></div><script type="module" src="/src/dev/ui/workbench.tsx"></script></body></html>')
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(html)
      })
    },
  }],
  server: {
    host: true,
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.data/**',
        '**/dist/**',
        '**/docs/vendor/**',
      ],
    },
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['lucide-react', 'react-markdown', 'remark-gfm'],
  },
})
