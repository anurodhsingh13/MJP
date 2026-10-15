import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const proxy = { '/api': `http://127.0.0.1:${env.API_PORT || 3001}` }
  return {
    plugins: [react()],
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: Number(env.WEB_PORT || 5173), strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: Number(env.WEB_PORT || 5173), strictPort: true, proxy },
  }
})
