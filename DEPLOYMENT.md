# CareDesk deployment

## Environment promotion model

- `staging` is the closed-release rehearsal branch. Every push must pass the same CI gates as `main` and produces a Vercel Preview deployment.
- `main` is the stable production branch and deploys to `https://care-platform-web.vercel.app`.
- Promote only by merging a green `staging` commit into `main`. Never develop directly on `main` during a release rehearsal.
- Record the promoted commit SHA in the release report. Roll back by redeploying the last known-good production commit; do not rewrite branch history.
- Preview deployments show a purple staging banner. The stable production hostname never shows that banner.

The closed-pilot build stores the typed workspace in Postgres and document bytes in a private Supabase Storage bucket. Browser storage is only a hydrated cache and is cleared between authenticated accounts. Production fails closed when authentication, the database, private storage, or the required migrations are missing.

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
  - `VITE_PUBLIC_SITE_URL=https://care-platform-web.vercel.app`
  - `VITE_PUBLIC_SIGNUP_URL=https://<approved-account-request-url>` (optional during the invitation-only pilot)

Both authentication variables are required in Preview and Production. A hosted build without either value fails closed and displays only the configuration-required screen. Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `VITE_` variable.

## Vercel API project

- Root Directory: `apps/api`
- Framework: Fastify
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @caredesk/api... build`
- Environment variable:
  - `CORS_ORIGINS=https://care-platform-web.vercel.app`
  - `DATABASE_URL=<least-privilege caredesk_app connection>`
  - `SUPABASE_URL=https://<project-ref>.supabase.co`
  - `SUPABASE_PUBLISHABLE_KEY=<publishable key>`
  - `SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>`
  - `SUPABASE_STORAGE_BUCKET=caredesk-private-documents`

The storage bucket must be private, limited to PDF/JPEG/PNG and 10 MB per object. The service-role key belongs only in the API project. Never add it to the web project or to a `VITE_` variable.

`apps/api/src/index.ts` is both the Vercel entrypoint and the local launcher. It
exports the Fastify instance by default, and opens a listening socket only when
executed directly outside Vercel.

## Verification

1. Open `https://care-platform-api.vercel.app/health` and expect HTTP 200 with
   `status: "ok"`.
2. Open `https://care-platform-api.vercel.app/ready` and expect HTTP 200 with
   `ready: true`. A 503 is a deployment blocker, even when `/health` is green.
3. Open `https://care-platform-web.vercel.app` and verify no localhost URL is
   displayed.
4. GitHub Actions must pass `check`, `e2e`, and `secret-scan`.
5. Sign in as two different pilot users and confirm that neither account can see the other's clients or documents.

## Public website and search indexing

- `/` is the public landing page, `/guide/direct-caregiver-employment` is the public guide, and `/app` is the authenticated application entrance.
- The public pages must contain no customer data. Private application routes set `noindex` and are also excluded in `robots.txt`.
- Before using a custom domain, replace `VITE_PUBLIC_SITE_URL` and the static URLs in `apps/web/index.html`, `apps/web/public/robots.txt`, and `apps/web/public/sitemap.xml` with the final HTTPS origin.
- Set `VITE_PUBLIC_SIGNUP_URL` only to an approved public account-request, contact, or scheduling form. If it is unset, the site correctly states that the pilot is invitation-only and sends existing customers to sign in.
- After the production hostname is stable, verify the domain in Google Search Console, submit `/sitemap.xml`, inspect both public URLs, and request indexing. Keep `/app` and all customer routes out of the sitemap.
- Recheck the public title, description, canonical URL, social preview, mobile layout, and the account-opening link after every production promotion.
