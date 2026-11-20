import { defineConfig } from 'vitest/config';

// Runs against the Firebase emulators (started by `firebase emulators:exec`).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ['tests/integration/setup.ts'],
  },
});
