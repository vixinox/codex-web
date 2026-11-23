import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '')

  return {
    envDir: workspaceRoot,
    // The Relay URL is intentionally public. Do not expose the rest of the server environment.
    define: {
      'import.meta.env.CODEX_REMOTE_RELAY_URL': JSON.stringify(env.CODEX_REMOTE_RELAY_URL ?? ''),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'ui-workbench',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use('/__dev/ui', async (request, response, next) => {
            if (request.url?.split('?')[0] !== '/' && request.url?.split('?')[0] !== '')
              return next()
            const html = await server.transformIndexHtml(
              '/__dev/ui',
              '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI 场景工作台</title></head><body><div id="root"></div><script type="module" src="/src/dev/ui/workbench.tsx"></script></body></html>',
            )
            response.setHeader('Content-Type', 'text/html; charset=utf-8')
            response.end(html)
          })
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
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
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      include: ['lucide-react', 'react-markdown', 'remark-gfm'],
    },
  }
})
