import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Env } from './env.js';
import type { Container } from './container.js';

// Dynamic imports catch module-load failures that static `import` declarations miss.
// If any workspace package is missing or has a top-level error, the try block catches
// it and returns a 503 app with the real error message — instead of Vercel's silent
// FUNCTION_INVOCATION_FAILED with zero logs.
type StartupResult =
  | { ok: true; env: Env; container: Container; app: FastifyInstance }
  | { ok: false; app: FastifyInstance };

const result: StartupResult = await (async (): Promise<StartupResult> => {
  try {
    const [{ buildContainer }, { loadEnv }, { buildServer }] = await Promise.all([
      import('./container.js'),
      import('./env.js'),
      import('./create-server.js'),
    ]);
    const env = loadEnv();
    const container = buildContainer(env);
    const app = buildServer(env, container);
    return { ok: true, env, container, app };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[CAREDESK_STARTUP_FAILED] ${message}`);
    const { default: Fastify } = await import('fastify');
    const errApp = Fastify({ logger: false });
    errApp.all('*', async (_req, reply) => {
      return reply.status(503).send({ error: 'startup_failed', message });
    });
    await errApp.ready();
    return { ok: false, app: errApp };
  }
})();

export default result.app;

async function startLocalServer(): Promise<void> {
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  const { env, container, app } = result;
  const { safeErrorDetails } = await import('./plugins/safe-error.js');
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(
      { persistence: container.pool ? 'postgres' : 'in-memory' },
      'case repository backend',
    );
  } catch (error) {
    app.log.error(safeErrorDetails(error), 'API failed to start');
    process.exitCode = 1;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (!result.ok) return;
  const { app, container } = result;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await container.pool?.end();
}

const executedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly && !process.env.VERCEL) {
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  void startLocalServer();
}
