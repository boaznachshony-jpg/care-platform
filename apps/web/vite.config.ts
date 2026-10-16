import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The same response headers `vercel.json` sets on every production response,
 * applied to `vite preview` so the Playwright suite (which runs against the
 * preview server) exercises the app under them. If a header ever breaks a
 * page it fails in CI, not on the customer's first visit.
 *
 * The CSP is report-only for one release; `vercel.json` is the source of
 * truth for the values and `src/vercel-headers.test.ts` asserts the two lists
 * do not drift apart.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy-Report-Only':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src blob:; connect-src 'self' https://care-platform-api.vercel.app https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

export default defineConfig({
  plugins: [react()],
  preview: {
    headers: SECURITY_HEADERS,
  },
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
