import { buildContainer } from './container.js';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

const env = loadEnv();
const container = buildContainer(env);
const app = buildServer(env, container);

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(
      { persistence: container.pool ? 'postgres' : 'in-memory' },
      'case repository backend',
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await container.pool?.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();
