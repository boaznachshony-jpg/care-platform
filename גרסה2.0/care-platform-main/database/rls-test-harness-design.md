# RLS Test Harness Design

Design only (Milestone 0, per `docs/architecture/repository-bootstrap-plan.md`
§M0.6) — no RLS policies exist yet to test, since no business table exists
until ADR-002 is Accepted and Milestone 1 schema work begins. This defines
the harness shape those future tests will use.

## Goal

Prove, for every tenant-owned table, that a session authenticated as tenant
A can never read, write, or enumerate a row belonging to tenant B — even
through a bug in application-level filtering (ADR-002's second line of
defense).

## Harness shape

1. **Two seeded tenants.** Every RLS test run creates exactly two synthetic
   tenants (`tenant-a`, `tenant-b`) with one row of each tenant-owned table
   under test, via `@caredesk/testing` fixtures — never real data.
2. **Per-role Postgres sessions.** The harness opens a raw `pg` connection
   per test, executes `set local role` (or `set_config('request.jwt.claims', ...)`
   matching however Supabase RLS reads the authenticated user, once ADR-001
   is Accepted and that mechanism is confirmed) to simulate a specific
   `(tenant_id, user_id, role)`, then runs the query under test.
3. **Required assertions per tenant-owned table:**
   - `SELECT` as tenant A never returns tenant B's row.
   - `UPDATE`/`DELETE` as tenant A affects zero rows when targeting tenant
     B's row by id (not an error — a silent zero-row match, which is what a
     correct RLS policy produces).
   - `INSERT` as tenant A with an explicit `tenant_id` of B is rejected.
   - A service-role/background-job connection (used for cross-tenant
     operations like scheduled reminders) is exercised separately and must
     log which tenant it is acting under (Constitution §19).
4. **Coverage gate.** Before Milestone 1's Definition of Done, generate the
   list of tenant-owned tables from `docs/architecture/database-blueprint.md`
   §4 and fail the test suite if any table lacks a corresponding RLS test —
   this becomes part of ADR-002's Acceptance Evidence checklist.

## What this harness does NOT cover

- Application-level authorization (`AuthorizationService` — see
  `packages/application/src/ports/authorization-service.ts`) is tested
  separately; RLS is the backstop, not the primary check.
- Performance/load testing of RLS policies — a later concern once real
  query patterns exist (`docs/architecture/database-blueprint.md` §8).
