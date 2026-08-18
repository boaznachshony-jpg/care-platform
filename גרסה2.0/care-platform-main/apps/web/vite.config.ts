import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces so the dev server is reachable from a phone on the
    // same network. This product is mobile-first for users in their 50s and
    // 60s, so RTL layout, tap targets and real on-screen-keyboard behaviour
    // want testing on a device, not only in a narrowed desktop viewport.
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setup-tests.ts'],
    globals: false,
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
