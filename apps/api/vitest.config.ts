import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The monorepo runs package suites concurrently. Limiting this suite's
    // worker pool prevents Fastify integration tests from competing for every
    // CPU at once and producing false five-second timeouts in CI.
    maxWorkers: 4,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
