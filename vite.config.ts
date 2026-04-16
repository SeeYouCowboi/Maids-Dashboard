import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

function readMaidsclawSha(): string {
  if (process.env.MAIDSCLAW_SHA) return process.env.MAIDSCLAW_SHA
  try {
    return fs.readFileSync(path.resolve(__dirname, '.maidsclaw-version'), 'utf-8').trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    alias: {
      '@maidsclaw/contracts': path.resolve(__dirname, '../MaidsClaw/src/contracts/cockpit'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0'),
    __MAIDSCLAW_SHA__: JSON.stringify(readMaidsclawSha()),
  },
})
