import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { buildContainer } from './container.js';
import { loadEnv } from './env.js';
import { buildServer } from './create-server.js';
import { safeErrorDetails } from './plugins/safe-error.js';

// Return 503 with real error instead of crashing Lambda — exposes env/startup failures.
function buildApp() {
  try {
    const env = loadEnv();
    const container = buildContainer(env);
    const app = buildServer(env, container);
    return { ok: true as const, env, container, app };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[CAREDESK_STARTUP_FAILED] ${message}`);
    const errApp = Fastify({ logger: false });
    void errApp.ready();
    errApp.all('*', async (_req, reply) => {
      return reply.status(503).send({ error: 'startup_failed', message });
    });
    return { ok: false as const, env: null, container: null, app: errApp };
  }
}

const result = buildApp();
export default result.app;

async function startLocalServer(): Promise<void> {
  if (!result.ok) { process.exitCode = 1; return; }
  const { env, container, app } = result;
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
