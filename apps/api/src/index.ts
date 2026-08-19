import { pathToFileURL } from 'node:url';
import { buildContainer } from './container.js';
import { loadEnv } from './env.js';
import { buildServer } from './create-server.js';
import { safeErrorDetails } from './plugins/safe-error.js';

// Wrap startup so Vercel's runtime logs show the real error message before
// FUNCTION_INVOCATION_FAILED obscures it. Without this, a bad env var produces
// a silent 500 with no log entry anywhere.
function buildApp() {
  try {
    const env = loadEnv();
    const container = buildContainer(env);
    /**
     * Vercel's Fastify runtime imports this module and requires the default export
     * to be a Fastify server instance. Keeping construction at module scope also
     * lets the runtime reuse a warm instance between invocations.
     */
    const app = buildServer(env, container);
    return { env, container, app };
  } catch (error) {
    // console.error is captured by Vercel before FUNCTION_INVOCATION_FAILED —
    // this surfaces the exact invalid/missing env var so it can be fixed.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[CAREDESK_STARTUP_FAILED] ${message}`);
    throw error;
  }
}

const { env, container, app } = buildApp();
export default app;

async function startLocalServer(): Promise<void> {
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
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await container.pool?.end();
}

// Start a listening socket only when this file is executed directly. When
// Vercel imports it, the platform owns the HTTP lifecycle and uses the default
// Fastify export above.
const executedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly && !process.env.VERCEL) {
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  void startLocalServer();
}
