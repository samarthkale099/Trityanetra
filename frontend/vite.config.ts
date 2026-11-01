import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: [
      // Order matters: aliases are applied in sequence, so the exact driver path
      // has to be claimed before the broader `@` -> src mapping rewrites it.
      // In `--mode e2e` the Firebase driver is replaced wholesale by an
      // in-memory one. An alias rather than a runtime flag means the mock is
      // absent from a real bundle entirely, so it cannot be reached by accident
      // and no credential is ever needed to run the suite.
      ...(mode === 'e2e'
        ? [{ find: '@/shared/lib/authDriver', replacement: path.resolve(rootDir, 'src/tests/e2eAuthDriver.ts') }]
        : []),
      { find: '@', replacement: path.resolve(rootDir, 'src') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL ?? 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
}))