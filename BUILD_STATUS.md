# CareDesk build status

Status date: **2026-08-10**

Baseline: `main` at `3eaee63`

## Recovery summary

The repository is substantially ahead of the older milestone documentation.
Milestone 0 is complete and the product is already a working pilot candidate;
the project must not be bootstrapped again. The current baseline contains a
React web application, Fastify API, PostgreSQL/Supabase persistence, tenant
isolation, authentication, billing, case management, documents, family access,
support requests, payroll records, national-insurance tracking, and automated
tests.

## Included in this E2E candidate

- Responsive RTL shell for desktop, tablet, and mobile.
- Dashboard, tasks, employee, documents, timeline, payroll, settings, and case flows.
- Vercel-compatible Fastify default export.
- Workspace dependency builds before Web/API builds.
- Unit, integration, accessibility, and Playwright E2E coverage.
- CI jobs for quality checks, E2E, and secret scanning.
- CORS configuration for the production Web domain.
- Supabase authentication and authenticated workspace recovery.
- Employment onboarding and employer/workspace switching.
- Persisted employment cases, contacts, tasks, timeline, and documents.
- Family-member invitation and access management.
- Subscription billing integration and account bootstrap.
- Payroll records, printable reports, and quarterly national-insurance tracking.
- Renewal-date follow-up task generation.
- Private in-app support requests.

## Current delivery state

| Area                                     | State                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Repository foundation and CI             | Complete                                                                      |
| Web and API application shells           | Complete                                                                      |
| Authentication and workspace persistence | Implemented                                                                   |
| Employment case foundation               | Implemented                                                                   |
| Contacts, tasks, timeline, and documents | Implemented                                                                   |
| Family access                            | Implemented                                                                   |
| Billing                                  | Implemented                                                                   |
| Payroll record workflow                  | Implemented; professional validation still blocks authoritative calculations  |
| Visa renewal                             | Date capture and follow-up tasks implemented; full persisted workflow is next |
| External AI                              | Disabled by design pending privacy approval                                   |

## Next engineering slice

**Milestone 2 — Visa Renewal Workflow**

1. Persist a workflow instance linked to the employment case.
2. Generate versioned steps from an approved workflow template.
3. Assign responsible, consulted, and informed contacts.
4. Record completion evidence and idempotent timeline/audit events.
5. Expose the workflow in the RTL web UI with loading, empty, error, and success states.
6. Add unit, integration, authorization, RLS, accessibility, and end-to-end coverage.

## Verification status

Dependencies were restored locally on 2026-08-10 and Prettier completed
successfully. The desktop command runner timed out while ESLint was still
running, so the complete local `pnpm check` result is not claimed. Recent
GitHub CI and Vercel checks on merged product changes are the authoritative
verification evidence until a fresh recovery PR completes all gates.

## Before real personal data

Production authentication/MFA, managed PostgreSQL, encrypted document storage,
backup/restore drills, monitoring, rate limiting, and professional payroll/legal
validation are still mandatory.
