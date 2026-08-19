// Vercel serverless entry point for the CareDesk API.
//
// The buildCommand runs "tsc" first (via pnpm --filter @caredesk/api... build),
// which produces dist/index.js.  That file exports the Fastify app instance
// as its default export with all startup errors caught internally.
//
// This file is placed in api/ so that @vercel/node auto-detects it as a
// serverless function.  All incoming routes are rewritten here by vercel.json.

import appInstance from '../dist/index.js';

// Ensure Fastify is fully initialised before the first request arrives.
// The top-level await in dist/index.js already ran, so this is a no-op
// after the first cold start.
await appInstance.ready();

export default async function handler(req, res) {
  // Forward the raw Node.js request/response pair into Fastify's HTTP server.
  // Fastify's router will match the original URL and dispatch to the right route.
  appInstance.server.emit('request', req, res);
}
