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
  - `FAMILY_INVITE_REDIRECT_URL=https://care-platform-web.vercel.app/app`

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
6. In one pilot tenant, invite a manager and a viewer. Confirm that both enter
   with their own one-time link, the manager can save, the viewer cannot save,
   neither can manage users, and revocation blocks the next API request.

The invitation redirect URL must also appear in the Supabase Auth redirect
allowlist. Preview testing should use an explicitly approved preview URL; do
not widen the allowlist with an unrestricted domain pattern.

## Product subscription and Cardcom

The CareDesk subscription is separate from caregiver payroll. The launch price
is 39 ILS per month including VAT (3,900 agorot). During the closed pilot every
tenant remains on a 100% discount and the effective charge is 0 ILS.

API-only environment variables:

- `BILLING_PROVIDER=cardcom`
- `BILLING_PRICE_AGOROT=3900`
- `BILLING_VAT_RATE_BPS=1800`
- `BILLING_LAUNCH_DISCOUNT_PERCENT=100`
- paid billing has no environment-wide start date; activate one notified tenant
  at a time with `pnpm billing:activate-subscription`
- `BILLING_SUCCESS_URL=https://care-platform-web.vercel.app/billing?setup=success`
- `BILLING_FAILURE_URL=https://care-platform-web.vercel.app/billing?setup=failed`
- `BILLING_WEBHOOK_URL=https://care-platform-api.vercel.app/billing/webhooks/cardcom`
- Cardcom terminal, API name/password and a base64 32-byte token-encryption key
- `CARDCOM_MARK_AS_RECURRING=true` only if Cardcom confirms that the merchant
  terminal is configured for standing-order transactions; otherwise keep false
- a random `CRON_SECRET` of at least 24 characters

The web project receives none of the Cardcom credentials. Card entry happens on
Cardcom's hosted page. The API verifies the returned setup server-to-server and
stores only an encrypted token plus expiry and last four digits.

Run migration `0014_product_billing.sql`, redeploy the API, and confirm `/ready`
before exposing `/billing`. Complete one production merchant test for hosted
setup, receipt delivery, webhook retry, idempotent collection and cancellation.
Do not treat Cardcom sandbox success as production approval.

Saving a card does not end the 100% pilot discount. To activate billing for one
customer only after advance notice, populate the three operator-only
`BILLING_ACTIVATION_*` values in `.env.local`, including the exact confirmation
documented in `.env.example`, then run:

```powershell
pnpm billing:activate-subscription
```

The command refuses tenants without accepted terms and a verified payment
method. There is no bulk activation path. Record the customer notice and the
command result in the release log before the first collection run.

## Public website and search indexing

- `/` is the public landing page, `/guide/direct-caregiver-employment` is the public guide, and `/app` is the authenticated application entrance.
- The public pages must contain no customer data. Private application routes set `noindex` and are also excluded in `robots.txt`.
- Before using a custom domain, replace `VITE_PUBLIC_SITE_URL` and the static URLs in `apps/web/index.html`, `apps/web/public/robots.txt`, and `apps/web/public/sitemap.xml` with the final HTTPS origin.
- Set `VITE_PUBLIC_SIGNUP_URL` only to an approved public account-request, contact, or scheduling form. If it is unset, the site correctly states that the pilot is invitation-only and sends existing customers to sign in.
- After the production hostname is stable, verify the domain in Google Search Console, submit `/sitemap.xml`, inspect both public URLs, and request indexing. Keep `/app` and all customer routes out of the sitemap.
- Recheck the public title, description, canonical URL, social preview, mobile layout, and the account-opening link after every production promotion.
