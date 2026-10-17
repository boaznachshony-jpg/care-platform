import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { build as bundle } from 'esbuild';
import { build } from 'vite';
import { externalPreviewOrigins, isExternalUxPreview } from './external-policy.js';
import { externalPreviewAuthPlugin } from './external-auth-plugin.js';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(webRoot, '.vercel/output');
if (output !== resolve(webRoot, '.vercel', 'output')) throw new Error('Unexpected output path.');
// Also clear when building production: cached preview output must never win
// over an ordinary Vite build in a reused build workspace.
await rm(output, { recursive: true, force: true });

if (!isExternalUxPreview(process.env)) {
  // Production and every other branch keep the original Vite build.
  await build({ root: webRoot });
} else {
  const origins = externalPreviewOrigins(process.env);
  // A clean web-only Vercel checkout has not built the API workspace packages.
  execSync('pnpm --filter @caredesk/api... build', { cwd: webRoot, stdio: 'inherit' });
  await build({
    root: resolve(webRoot, 'ux-v2'),
    configFile: resolve(webRoot, 'vite.ux-v2.config.ts'),
    define: {
      'import.meta.env.VITE_UX_V2_PREVIEW_ORIGINS': JSON.stringify(JSON.stringify(origins)),
      'import.meta.env.VITE_PUBLIC_SITE_URL': JSON.stringify(origins[0]),
    },
    plugins: [externalPreviewAuthPlugin()],
  });

  const functionRoot = resolve(output, 'functions/__ux_api.func');
  await mkdir(functionRoot, { recursive: true });
  await cp(resolve(webRoot, 'build/ux-v2/dist'), resolve(output, 'static'), { recursive: true });
  await bundle({
    entryPoints: [resolve(webRoot, 'ux-v2/external-api.ts')],
    outfile: resolve(functionRoot, 'index.mjs'),
    platform: 'node',
    target: 'node24',
    format: 'esm',
    bundle: true,
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    external: ['pg-native'],
  });
  await writeFile(
    resolve(functionRoot, '.vc-config.json'),
    JSON.stringify({
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      maxDuration: 60,
    }),
  );
  await writeFile(
    resolve(output, 'config.json'),
    JSON.stringify({
      version: 3,
      routes: [
        {
          src: '/(.*)',
          headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
          continue: true,
        },
        { src: '/__ux_api(?:/.*)?', dest: '/__ux_api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    }),
  );
}
