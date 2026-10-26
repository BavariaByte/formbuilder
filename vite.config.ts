import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  base: "/",
  plugins: [
    vue(),
    // Serve the template_playbooks folder in dev, mirroring the nginx autoindex JSON format
    {
      name: 'template-playbooks-dev-server',
      configureServer(server) {
        const templatesDir = path.resolve(__dirname, 'template_playbooks')

        server.middlewares.use('/template_playbooks', (req, res, next) => {
          const url = req.url ?? '/'
          const clean = url.split('?')[0]

          // Directory listing → return nginx-style autoindex JSON
          if (clean === '/' || clean === '') {
            if (!fs.existsSync(templatesDir)) {
              res.statusCode = 404
              res.end('[]')
              return
            }
            const entries = fs.readdirSync(templatesDir)
              .filter(f => f.endsWith('.json'))
              .sort()
              .map(name => {
                const stat = fs.statSync(path.join(templatesDir, name))
                return { name, type: 'file', mtime: stat.mtime.toUTCString(), size: stat.size }
              })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(entries))
            return
          }

          // Individual file request — only allow .json files inside templatesDir
          const requested = clean.slice(1)
          if (!requested.endsWith('.json')) {
            next()
            return
          }
          const resolved = path.resolve(templatesDir, requested)
          if (resolved !== templatesDir && !resolved.startsWith(templatesDir + path.sep)) {
            res.statusCode = 403
            res.end()
            return
          }
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            res.setHeader('Content-Type', 'application/json')
            res.end(fs.readFileSync(resolved))
            return
          }

          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 8080,
  },
  build: {
    rollupOptions: {
      output: {
        // Conservative vendor code-splitting to keep the main chunk small
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/elkjs/')) return 'vendor-elk'
          if (id.includes('/rete')) return 'vendor-rete'
          if (id.includes('/@vue/') || id.includes('/vue/') || id.includes('/pinia/')) return 'vendor-vue'
          return 'vendor'
        },
      },
    },
  },
})
