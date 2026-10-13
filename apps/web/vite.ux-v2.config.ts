import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxy = {
  '/__ux_api': {
    target: 'http://127.0.0.1:4183',
    rewrite: (path: string) => path.replace(/^\/__ux_api/, ''),
  },
};

export default defineConfig({
  root: 'ux-v2',
  envDir: false,
  // Override every product environment input: never inherit production auth,
  // API URLs or feature flags from the shell running this separate build.
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/__ux_api'),
    'import.meta.env.VITE_DEV_TOKEN': JSON.stringify('dev-local-token'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(''),
    'import.meta.env.VITE_REGULATION_CONSOLE': JSON.stringify(''),
    'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify('http://127.0.0.1:4182'),
    'import.meta.env.VITE_PUBLIC_SIGNUP_URL': JSON.stringify(''),
  },
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
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
          injectTo: 'head-prepend',
        },
      ],
    },
  ],
  server: { host: '127.0.0.1', port: 5182, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4182, strictPort: true, proxy },
  build: { outDir: '../build/ux-v2/dist', emptyOutDir: true },
});
