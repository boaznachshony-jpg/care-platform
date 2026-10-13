import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Separate entry and output: the normal production build never includes this demo.
export default defineConfig({
  root: 'ux-v2',
  plugins: [
    react(),
    {
      name: 'ux-v2-preview-policy',
      apply: 'build',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
          },
          injectTo: 'head-prepend',
        },
      ],
    },
  ],
  server: { host: '127.0.0.1', port: 5182, strictPort: true },
  preview: { host: '127.0.0.1', port: 4182, strictPort: true },
  build: { outDir: '../build/ux-v2', emptyOutDir: true },
});
