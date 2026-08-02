# CareDesk deployment

## Environment promotion model

- `staging` is the closed-release rehearsal branch. Every push must pass the same CI gates as `main` and produces a Vercel Preview deployment.
- `main` is the stable production branch and deploys to `https://care-platform-web.vercel.app`.
- Promote only by merging a green `staging` commit into `main`. Never develop directly on `main` during a release rehearsal.
- Record the promoted commit SHA in the release report. Roll back by redeploying the last known-good production commit; do not rewrite branch history.
- Preview deployments show a purple staging banner. The stable production hostname never shows that banner.

The current RC stores client data in the tester's browser. Staging is therefore suitable for release-flow rehearsal, not for cross-device collaboration or commercial data. Managed authentication and server-side tenancy must be completed before a real pilot.

## Vercel Web project

- Root Directory: `apps/web`
- Framework: Vite
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @caredesk/web... build`
- Output Directory: `dist`
- Environment variable:
  - `VITE_API_BASE_URL=https://care-platform-api.vercel.app`
  - `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY=<browser-safe publishable key>`

Both authentication variables are required in Preview and Production. A hosted build without either value fails closed and displays only the configuration-required screen. Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `VITE_` variable.

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
