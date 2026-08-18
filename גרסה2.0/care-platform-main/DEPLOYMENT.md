# CareDesk deployment

## Vercel Web project

- Root Directory: `apps/web`
- Framework: Vite
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @caredesk/web... build`
- Output Directory: `dist`
- Environment variable:
  - `VITE_API_BASE_URL=https://care-platform-api.vercel.app`

## Vercel API project

- Root Directory: `apps/api`
- Framework: Fastify
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @caredesk/api... build`
- Environment variable:
  - `CORS_ORIGINS=https://care-platform-web.vercel.app`

`apps/api/src/index.ts` is both the Vercel entrypoint and the local launcher. It
exports the Fastify instance by default, and opens a listening socket only when
executed directly outside Vercel.

## Verification

1. Open `https://care-platform-api.vercel.app/health` and expect HTTP 200 with
   `status: "ok"`.
2. Open `https://care-platform-web.vercel.app` and verify no localhost URL is
   displayed.
3. GitHub Actions must pass `check`, `e2e`, and `secret-scan`.
