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
- Dependency and secret scanning run in CI (`docs/architecture/repository-bootstrap-plan.md`
  §M0.7); do not merge with an unresolved high-severity finding without
  documented, time-boxed approval (Constitution §33 exception process).
- Server-side authorization is mandatory on every protected route; the UI may
  hide unavailable actions but must never be the only enforcement point
  (Constitution §18).
