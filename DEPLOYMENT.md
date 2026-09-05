# CareDesk deployment

> Preview and Production must not share a Supabase project. The per-environment
> variable scoping that keeps them apart is dashboard state, not repository
> state, so it is written down and verified separately:
> [`docs/governance/ENVIRONMENT-SEPARATION.md`](docs/governance/ENVIRONMENT-SEPARATION.md).
> The API refuses to start when a non-production deployment is handed the
> production database, but only once `PRODUCTION_SUPABASE_PROJECT_REF` is set.

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

### Browser security headers

`apps/web/vercel.json` sets these response headers on every path of the web
origin: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
(camera, geolocation, microphone, payment and USB all disabled),
`Strict-Transport-Security: max-age=31536000; includeSubDomains`, and a
Content Security Policy. The same set is applied to `vite preview`, so the
Playwright suite runs under it.

The CSP is delivered as `Content-Security-Policy-Report-Only` for one
production release. In that mode the browser reports what it would have
blocked and blocks nothing, which is the point: the policy allows only the
bundle, Google Fonts, the API origin and Supabase, and the release that ships
it is the release in which the browser console of a real session is checked
for CSP violations. When one full release cycle has passed with none, rename
the header to `Content-Security-Policy` in `apps/web/vercel.json` and in the
`SECURITY_HEADERS` block of `apps/web/vite.config.ts`, and update
`apps/web/src/vercel-headers.test.ts` to expect the enforcing name. Any new
third-party origin the app talks to (fonts, API host, custom domain for the
API) must be added to the policy in the same PR, or the enforcing header will
block it.

`apps/web/public/` may contain only `robots.txt` and `sitemap.xml`; every file
there is served verbatim from the production origin, outside the bundle and
outside the CSP's `script-src`. A test fails on anything else.

## Vercel API project

- Root Directory: `apps/api`
- Framework: Fastify
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @caredesk/api... build`

### Variables the API refuses to start without in production

`apps/api/src/env.ts` validates the environment at startup. In production
(`NODE_ENV=production`) each variable below is mandatory, and the consequence
listed is what would happen if the check did not exist - it is also the exact
text of the startup error, so an operator reading a `503 startup_failed` knows
what to set.

| Variable                                                                                    | Without it                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL=<least-privilege caredesk_app connection>`                                    | the API would silently run on the in-memory repositories: every save answers 200 and is gone on the next invocation                                                                                                            |
| `SUPABASE_URL=https://<project-ref>.supabase.co`                                            | authentication would fall back to the mock auth service                                                                                                                                                                        |
| `SUPABASE_PUBLISHABLE_KEY=<publishable key>`                                                | authentication would fall back to the mock auth service (must be set together with `SUPABASE_URL`)                                                                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>`                                  | private document storage would be unconfigured                                                                                                                                                                                 |
| `SUPABASE_STORAGE_BUCKET=caredesk-private-documents`                                        | private document storage would be unconfigured (must be set together with the service-role key)                                                                                                                                |
| `WORKSPACE_ENCRYPTION_KEY=<base64-encoded 32-byte key>`                                     | required for a production database: the workspace payload could not be sealed. Generate with `openssl rand -base64 32`; put it into escrow first (see below)                                                                   |
| `BACKUP_SUPABASE_URL`, `BACKUP_SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_SUPABASE_STORAGE_BUCKET` | production document storage requires an independent backup destination; all three together, in a different Supabase project from the primary                                                                                   |
| `PRODUCTION_SUPABASE_PROJECT_REF=<project ref of the production database>`                  | set on **all** Vercel environments. A Preview deployment with a `DATABASE_URL` and no ref refuses to start, because it cannot prove it was not handed production. Production itself starts without it, with the guard disarmed |

### Variables production is not complete without

These do not stop the process. `DATA_LOSS_ALERT_EMAIL` makes `GET /ready`
answer 503 with the reason until it is set, and a 503 on `/ready` is a
deployment blocker. `CRON_SECRET` is not yet checked by `/ready` (tracked as
audit finding SEC-INFRA-03), so its absence has to be caught by reading this
table and by checking a cron invocation log for a 200:

| Variable                                               | Without it                                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_LOSS_ALERT_EMAIL=<server-only operator mailbox>` | a suspected data loss found by the nightly scan would be logged and nobody told. Requires `RESEND_API_KEY` and `SUPPORT_FROM_EMAIL` to deliver through    |
| `CRON_SECRET=<at least 24 random characters>`          | Vercel's scheduled invocations of the nightly data-integrity scan and the billing collection are rejected with 401 on every run - the detector never runs |

### Other API variables

- `CORS_ORIGINS=https://caredesk-isr.com,https://www.caredesk-isr.com,https://care-platform-web.vercel.app`
  - the canonical production origin first; a missing value falls back to the
    built-in default with the same origins, never to a wildcard
- `WORKSPACE_ENCRYPTION_PREVIOUS_KEYS=<comma-separated retired keys>` — only during a rotation
- `FAMILY_INVITE_REDIRECT_URL=https://care-platform-web.vercel.app/app`
  - optional; unset, invitations land on the first https origin in `CORS_ORIGINS`
- `SUPPORT_DESTINATION_EMAIL=<server-only destination address>`
- `SUPPORT_FROM_EMAIL=<verified sender address>`
- `RESEND_API_KEY=<server-only Resend key>`
  - the three support values are set together or not at all; without them the
    contact form has no transport and `DATA_LOSS_ALERT_EMAIL` cannot deliver
- `SENSITIVE_OPERATION_MFA_MODE=report` — switch to `enforce` only after every
  pilot identity has an AAL2 factor
- `LOG_LEVEL=info`, `CORRELATION_HEADER=x-correlation-id` — defaults are fine
- `AI_PROVIDER=mock` — must stay `mock` until an approved AI Privacy Impact
  Assessment and DPA exist
- `VERCEL`, `VERCEL_ENV` — injected by Vercel; never set by hand

The storage bucket must be private, limited to PDF/JPEG/PNG and 10 MB per object. The service-role key belongs only in the API project. Never add it to the web project or to a `VITE_` variable.

`WORKSPACE_ENCRYPTION_KEY` encrypts `tenant_workspace.payload` and every
archived version of it, so it is also the key that every backup is encrypted
under. Production refuses to start without it once a database is configured.
Losing it loses the customer data and its entire version history, in every copy,
permanently: see `docs/governance/ENCRYPTION-KEY-CUSTODY.md` for the escrow this
requires before it is set.

Rotating it is a process, not an event. Every envelope records a `keyId` derived
from the key that sealed it, so a deployment can hold several keys and still know
which one each row needs. To rotate: put the new key in `WORKSPACE_ENCRYPTION_KEY`
and move the outgoing one to `WORKSPACE_ENCRYPTION_PREVIOUS_KEYS`, deploy, let the
data be rewritten, then drop the retired key. Rows written before `keyId` existed
carry none, and are opened by trying each configured key in turn - GCM
authenticates, so a wrong key throws rather than returning plausible nonsense.
Put the new key into escrow **before** it reaches any deployment: a key that
exists only in a write-only environment variable cannot be copied afterwards.

`CRON_SECRET` authenticates both scheduled endpoints declared in
`apps/api/vercel.json`: the recurring billing collection and the nightly
data-loss scan (`/internal/jobs/data-integrity-scan`). Without it the scan
never runs, and a detector that does not run is not silent - it is blind. Check
that it ran, not only that it reported nothing. Generate the value with
`openssl rand -base64 32` (or a password manager's 32+ character random
string) and never with a memorable phrase: the API runs as serverless
functions, so its brute-force limiter is best-effort per function instance,
and the secret's entropy is the control that actually holds.

Contact delivery is also API-only. The destination and provider key must be set
only on the API project; the web project receives neither value. Verify the
sender domain in Resend, submit one help request and one improvement suggestion,
and confirm that both arrive with the visitor's address set as Reply-To.

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
4. Run `curl -I https://www.caredesk-isr.com/app` (or the Vercel hostname) and
   confirm the response carries `x-frame-options`, `x-content-type-options`,
   `referrer-policy`, `permissions-policy`, `strict-transport-security` and
   `content-security-policy-report-only`. A missing header means
   `apps/web/vercel.json` was not deployed from the expected commit.
5. GitHub Actions must pass every job behind `required-quality-gates`,
   including `static` (format, lint, dependency audit) and `secret-scan`.
6. Sign in as two different pilot users and confirm that neither account can see the other's clients or documents.
7. In one pilot tenant, invite a manager and a viewer. Confirm that both enter
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

- `/` is the public landing page, `/guide/direct-caregiver-employment` is the public guide, `/contact-us` is the public contact page, and `/app` is the authenticated application entrance.
- The public pages must contain no customer data. Private application routes set `noindex` and are also excluded in `robots.txt`.
- Before using a custom domain, replace `VITE_PUBLIC_SITE_URL` and the static URLs in `apps/web/index.html`, `apps/web/public/robots.txt`, and `apps/web/public/sitemap.xml` with the final HTTPS origin.
- Set `VITE_PUBLIC_SIGNUP_URL` only to an approved public account-request, contact, or scheduling form. If it is unset, the site correctly states that the pilot is invitation-only and sends existing customers to sign in.
- After the production hostname is stable, verify the domain in Google Search Console, submit `/sitemap.xml`, inspect both public URLs, and request indexing. Keep `/app` and all customer routes out of the sitemap.
- Recheck the public title, description, canonical URL, social preview, mobile layout, and the account-opening link after every production promotion.
