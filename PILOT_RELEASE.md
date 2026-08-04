# CareDesk closed commercial pilot

This runbook is the release gate for a small, named group of potential customers. A green build alone is not permission to accept real personal data.

## 1. One-time infrastructure

1. Select and document the approved Supabase project/data region. Do not use the current synthetic-data project for real customer data until the region and processor terms are approved.
2. Run `pnpm db:migrate` with the owner-only `DATABASE_ADMIN_URL`.
3. Run `pnpm db:provision-app-role`, then put only the least-privilege `caredesk_app` connection in the API's `DATABASE_URL`.
4. Run `pnpm db:rls-test`. Cross-tenant reads and writes must be refused.
5. Create `caredesk-private-documents` as a **private** Supabase Storage bucket. Allow only PDF, JPEG and PNG, with a 10 MB limit.
6. Configure the API and web variables listed in `DEPLOYMENT.md`. Restrict CORS to the exact pilot web hostname.
7. Confirm database backups and perform one restore rehearsal before inviting customers.

## 2. Create each customer account

1. Invite the named customer in Supabase Auth. CareDesk never stores their password.
2. Copy the Auth user's UUID into `PILOT_AUTH_SUBJECT` in the operator's untracked `.env.local`.
3. Fill `PILOT_EMAIL`, `PILOT_DISPLAY_NAME`, `PILOT_ACCOUNT_NAME`, and the approved `PILOT_DATA_REGION`.
4. Run `pnpm pilot:provision-account`. It is idempotent and creates exactly one tenant membership. It refuses ambiguous or conflicting identities.
5. Leave `PILOT_MFA_REQUIRED=false` until the user has enrolled an AAL2 factor. Once enrolled, set it to `true` and run the command again; the API then rejects non-MFA sessions.
6. Sign in once with the customer and verify the client list starts empty.

## 3. Technical release gate

- `pnpm check` passes.
- Desktop and mobile Playwright suites pass.
- API `/health` returns 200 and `/ready` returns `ready: true`.
- Login, logout and account switching never reveal the previous account's cached data.
- Two-tenant isolation is tested with real pilot identities.
- Create, edit, save and reopen a client on a second device.
- Upload, open and delete a PDF, JPEG and PNG; copied signed links expire.
- Complete onboarding, tasks, reminders, documents, timeline and monthly payroll.
- Print the bilingual payroll preview and reconcile the annual total.
- Export and account-deletion requests have a named operator and written response procedure.
- Logs contain correlation IDs but no document bytes, passwords or full identity values.
- The last known-good commit and Vercel rollback deployment are recorded.

## 4. Privacy and commercial gate

Before the first real customer's data is entered, obtain named legal/security approval for:

- the privacy notice, terms, product owner/contact identity and lawful purposes;
- data retention and deletion periods for profiles, documents, payroll and audit records;
- processor agreements and any cross-border transfer/data-region implications;
- database registration/notification applicability and an information-security risk assessment;
- a serious security-incident response process and customer contact path;
- review of payroll/employment explanations so the product is not represented as professional legal or accounting advice.

Record the approver, date and approved document version. Do not replace this gate with an in-product disclaimer.

## 5. Controlled operation

- Invite only named pilot customers; public registration remains disabled.
- The public landing page and guide contain no customer data. Their account-opening action must use an approved external request/contact URL or remain explicitly invitation-only.
- Do not request public search indexing until the public copy, privacy notice, product-owner identity, custom domain and canonical/sitemap URLs are approved.
- Use synthetic data for demonstrations. Real data belongs only to the authenticated customer's tenant.
- Review `/ready`, failed logins, storage errors and failed CI daily during the pilot.
- Stop new invitations on any cross-tenant, data-loss, document-access or payroll-calculation defect.
- Promote `staging` to `main` only after the same commit passes every gate above.
