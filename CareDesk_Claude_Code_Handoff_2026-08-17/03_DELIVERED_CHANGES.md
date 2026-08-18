# Delivered Changes

## Wave 2
Visa Renewal persistence, APIs, idempotent commands, overlap review, completion, Timeline/Audit, validation hardening.

## Wave 3
Canonical Timeline, Dashboard/CareDesk Score, Monthly Close and Product Intelligence.

## Wave 4
Smart Document Intake contracts, case-aware assistant, Event Wizard catalog, governed rules, RLS review persistence, fail-closed provider boundary.

## Wave 5
Family/worker persistence, activation/access, assignments, requests, preferences, notifications, signed document access, manager auth/idempotency/evidence.

## Wave 6
Future Cost planning foundation, Emergency Binder print foundation, Professional Review request foundation.

## PR #55 — Canonical Payroll Backend
`payroll_entry`, FORCE RLS, same-tenant constraints, list/get/save APIs, idempotency, optimistic locking, Timeline/Audit, rate limiting. UUID-shaped client IDs are explicitly NOT authority.

## PR #65 — Payroll UI + Future Cost
Case-scoped canonical payroll editor.
Future Cost precedence:
1. closed `payroll_month_close`
2. open `payroll_entry`
3. forecast/unknown

No permanent dual-write. Explicit user-mediated legacy preparation.

## Architectural rules
- `main` is authority.
- `/clients/:clientId` is compatibility context; never infer EmploymentCase by UUID shape.
- canonical sensitive facts use PostgreSQL/API.
- no permanent dual-write.
- closed payroll = `payroll_month_close`.
- open payroll = `payroll_entry`.
- server-derived tenant/case authority.
- FORCE RLS + same-tenant integrity.
- durable idempotency.
- Timeline for human history; Audit for minimal security evidence.
- AI/OCR/WhatsApp remain fail-closed until approved.
