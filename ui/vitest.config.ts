import { defineConfig } from 'vitest/config'

// Test del codice server (utility, migrazioni, API) su DB SQLite sintetici: niente Nuxt.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
