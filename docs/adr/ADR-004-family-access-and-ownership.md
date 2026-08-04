# ADR-004: Family access and ownership

- Status: **Accepted — closed-pilot scope**
- Date: 2026-08-04
- Owners: Product, Security, Engineering
- Approved by: Product Owner direction to support authorized non-customer users
- Approved at: 2026-08-04

## Context

Several relatives may operate one family file. A saved authorized contact is
not enough: the system must know who viewed or changed the file, while keeping
sign-in simple for family members who are not the employer or care recipient.

## Decision

Every person receives an individual Supabase identity and a separate
`TenantMembership`. Credentials are never shared. The owner sends an email
invitation; Supabase verifies a one-time link and the browser keeps a managed
session. An already-invited user may request another one-time link from the
sign-in page without creating a new account.

Closed-pilot roles are:

- `owner`: all operational actions plus invitation, role-change and revocation.
- `manager`: all operational actions in the shared family workspace, but no
  user or ownership administration.
- `viewer`: read-only access to the whole family workspace.

Legacy `family_member` memberships remain a read-only alias for `viewer`.
Contacts and authorized representatives never receive a login or role
implicitly; the owner must invite the person separately.

Membership changes and workspace writes are append-only audit events with the
authenticated actor. Concurrent workspace edits use optimistic concurrency:
the first save wins and a stale second save receives a conflict instead of
overwriting newer data.

## Pilot safety boundaries

- A user may belong to one active tenant until an explicit tenant switcher is
  designed and tested.
- Viewer access is tenant-wide and includes all file data. Field-level masking
  is not claimed in this release.
- Ownership cannot be removed or changed in self-service. During the closed
  pilot, transfer requires a verified support process and a documented audit
  event. Self-service transfer, guardianship evidence and dispute handling are
  release gates for a broader commercial launch.
- The audit store records the actor and operation. A user-facing detailed
  activity screen and field-level before/after history are not claimed yet.

## Consequences

- Family collaboration no longer requires shared passwords or a shared browser.
- Removing a membership immediately blocks future actor resolution and API
  access; an existing token alone does not grant access.
- Supabase redirect allowlists and `FAMILY_INVITE_REDIRECT_URL` become part of
  deployment configuration.
- Invitation delivery spans Supabase Auth and PostgreSQL and is not a single
  database transaction. Failed invitations must be observable and retryable
  during pilot support.

## Acceptance evidence

- API tests cover invite, role change, revocation, duplicate rejection and
  owner protection.
- UI tests cover the owner invitation flow and hidden management controls for
  read-only users.
- Production testing must use three real identities in one tenant: owner,
  manager and viewer.
