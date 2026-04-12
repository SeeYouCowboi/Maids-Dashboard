import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@maidsclaw/contracts': path.resolve(__dirname, '../MaidsClaw/src/contracts/cockpit'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0'),
    __MAIDSCLAW_SHA__: JSON.stringify(process.env.MAIDSCLAW_SHA || 'dev'),
  },
})
