# Security Policy

CareDesk handles identity, employment, financial, and care-related data for
real families. Treat every security report as high priority.

## Reporting a vulnerability

Do not open a public GitHub issue for a suspected vulnerability. Contact the
repository owner directly and include:

- A description of the issue and its potential impact.
- Steps to reproduce (no real personal data in the report — use synthetic
  examples).
- Any relevant logs, with sensitive fields redacted.

## Rules for this repository

- No secrets in code, commit history, prompts, or client bundles. Use managed
  secret storage; `.env.example` documents variable names only.
- No real personal data in fixtures, tests, screenshots, or demos — synthetic
  data only (Constitution §16, §25).
- Three automated controls run on every pull request and every push to
  `main`/`staging` (`.github/workflows/ci.yml`), and a fourth runs weekly:
  - secret scan: `gitleaks` over the full history (`secret-scan` job; the
    allowlist is `.gitleaks.toml`);
  - dependency audit: `pnpm audit --prod --audit-level=high` (`static` job) —
    a high or critical advisory in a production dependency fails CI;
  - repository hygiene: `scripts/check-repo-hygiene.mjs` (`pnpm lint`) fails
    on tracked archive directories, Windows `- Copy` duplicates, undeclared
    lock-file overrides and any tracked `.pdf/.docx/.xlsx/.zip/.png/.jpg`
    outside `docs/`, `apps/web/public/` and `packages/ui/`;
  - Dependabot (`.github/dependabot.yml`): weekly npm and GitHub Actions
    update PRs, Monday 05:00 Asia/Jerusalem.
- Do not merge with an unresolved high-severity finding without documented,
  time-boxed approval (Constitution §33 exception process). Moderate advisories
  do not fail CI; they are resolved through the Dependabot PR, not ignored.
- Browser security headers for the web origin are declared in
  `apps/web/vercel.json` and mirrored into `vite preview` for the end-to-end
  suite; `apps/web/src/vercel-headers.test.ts` fails when one is removed. The
  API sets its own in `apps/api/src/plugins/security-headers.ts`.
- Server-side authorization is mandatory on every protected route; the UI may
  hide unavailable actions but must never be the only enforcement point
  (Constitution §18).
