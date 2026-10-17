import { createServer, preview } from 'vite';
import { buildServer } from '../../api/src/create-server.js';
import { loadEnv } from '../../api/src/env.js';
import { DEV_TOKEN } from '../../api/src/container.js';
import fixture from '../src/ux-v2/fixture.json';

// Deliberately do not read process.env or any .env file. The existing API uses
// its in-memory repositories and mock providers without database credentials.
const api = buildServer(loadEnv({ NODE_ENV: 'development', LOG_LEVEL: 'error' }));
const seeded = await api.inject({
  method: 'POST',
  url: '/cases',
  headers: { authorization: `Bearer ${DEV_TOKEN}` },
  payload: {
    legacyClientId: fixture.clientId,
    careRecipient: { fullName: fixture.profile.recipientName },
    employer: { fullName: fixture.profile.employerName, relationshipToRecipient: 'child' },
    caregiver: {
      legalName: fixture.profile.caregiverName,
      nationality: fixture.profile.caregiverCountry,
    },
    startDate: fixture.profile.employmentStartDate,
  },
});
if (seeded.statusCode !== 201) throw new Error(`Preview seed failed: ${seeded.body}`);
await api.listen({ host: '127.0.0.1', port: 4183 });
try {
  const options = { configFile: 'vite.ux-v2.config.ts' };
  const web = process.argv.includes('--dev')
    ? await createServer(options).then(async (server) => {
        await server.listen();
        return server;
      })
    : await preview(options);
  web.printUrls();
  const stop = async () => {
    await api.close();
    await web.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  await api.close();
  throw error;
}
