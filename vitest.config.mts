import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
    hookTimeout: 300_000,
    // Integration tests share the CPU with up to N in-memory MongoDB servers: 5 s is too tight under load.
    testTimeout: 30_000,
  },
})
