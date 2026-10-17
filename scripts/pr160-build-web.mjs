import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { validatePr160TestWebEnvironment } from './pr160-test-environment.mjs';

// Validate the actual platform target before loading Vite or reading local env files.
let configuration;
try {
  configuration = validatePr160TestWebEnvironment(process.env);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  process.stdout.write(`${JSON.stringify(configuration.publicReport, null, 2)}\n`);
} else {
  const webRoot = fileURLToPath(new URL('../apps/web/', import.meta.url));
  const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  // The original entrypoint, React plugin and auth/API code remain authoritative.
  // Override every product VITE setting explicitly; never inherit a local .env.
  await build({
    root: webRoot,
    configFile: fileURLToPath(new URL('../apps/web/vite.config.ts', import.meta.url)),
    mode: 'ux-v2-test',
    envDir: false,
    define: Object.fromEntries(
      Object.entries(configuration.webEnv).map(([key, value]) => [
        `import.meta.env.${key}`,
        JSON.stringify(value),
      ]),
    ),
  });
}
