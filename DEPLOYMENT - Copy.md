# CareDesk deployment

## Web project

- Root Directory: `apps/web`
- Framework: Vite
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm --filter @caredesk/web... build`
- Output: `dist`
- Environment: `VITE_API_BASE_URL=https://care-platform-api.vercel.app`

## API project

- Root Directory: `apps/api`
- Framework: Fastify
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm --filter @caredesk/api... build`
- Environment:
  - `NODE_ENV=production`
  - `CORS_ORIGINS=https://care-platform-web.vercel.app`
  - `LOG_LEVEL=info`

The `...` suffix on the pnpm filters is required: it builds workspace dependencies before the app itself. Workspace packages publish their runtime entry from `dist/`, avoiding serverless functions importing TypeScript source files at runtime.
