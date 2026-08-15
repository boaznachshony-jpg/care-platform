# Wave 5 — collaboration and engagement

> Completion status (2026-08-15): this architecture describes the Wave 5
> foundation, not completed user-facing functionality. See
> `docs/governance/wave-5-definition-of-done.md` for the exact gap inventory and
> current close decision.

## Phase 0: exact baseline and gaps

Wave 5 was based on merge `50e66f2` (PR #41). The Wave 4 document-intake,
case-assistant, event-wizard, versioned regulation, durable PostgreSQL/RLS and
the Wave 3 Timeline, Decision Dashboard, score, analytics, forecast and monthly
close foundations were present and were reused.

| Area | State before Wave 5 | Wave 5 decision |
| --- | --- | --- |
| Tenant membership / family invitations | `app_user` plus tenant-scoped `tenant_membership`; owner/manager/viewer/family-member vocabulary; owner-created one-time Supabase invitation and revocation | Keep base roles. Add case-scoped responsibility ownership rather than more roles. |
| Authentication | Supabase JWT authentication resolves exactly one active tenant membership; tenant authority is server-derived | Workers receive a separate explicit, activatable and revocable worker-to-caregiver-to-case relationship. Knowing a case ID is never authority. |
| Caregiver / contacts | `caregiver` is a tenant-owned employment party; contacts are business contacts and never users implicitly | Link an authenticated `app_user` explicitly through `worker_portal_access`; do not convert contacts implicitly. |
| Tasks | Canonical tenant/case `task` has due date, status, creator/source and workflow linkage; no general family assignee | Add same-tenant `assignee_membership_id`; keep one task and record human assignment/completion through existing Timeline/Audit services. |
| Payroll / monthly close | MVP payroll facts and deterministic analytics exist; `payroll_month_close` is durable, tenant-scoped, append-only and only supports pending acknowledgement | Add append-only worker acknowledgement evidence. Worker projections admit closed facts only. |
| Vacation / leave | MVP payroll inputs record leave days; no governed statutory entitlement or durable leave ledger exists | Shared projection accepts canonical facts and an optional governed balance. It returns `null` rather than inventing entitlement. Vacation requests are durable workflow facts. |
| Documents / permissions | Private object storage, signed-link authorization, sensitivity and immutable versions exist; no explicit worker visibility | Add an explicit deny-by-default visibility policy (`employer_only`, `worker_view`, `worker_action`). Category or filename is not authorization. |
| Timeline / audit | Canonical translated Timeline and append-only audit event are tenant/case scoped | Material responsibility, task, invitation, request and acknowledgement changes use these systems; provider attempts do not pollute Timeline. |
| Notifications / reminders | Browser reminders and governed reminder proposals exist; no transactional orchestration or delivery evidence | Add provider-independent intents, preferences, consent and attempts with idempotency. No duplicate notification system is introduced in the UI. |
| Email / Resend | Support route directly used server-side `RESEND_API_KEY` and `SUPPORT_FROM_EMAIL` | Extract and reuse one server-only Resend adapter for support and product delivery. Store provider evidence, not rendered bodies. |
| Supabase Auth email | Supabase owns verification, recovery and security email | This boundary remains. CareDesk/Resend owns transactional product messages and application-owned invitations only. Production should configure Supabase SMTP with a verified sender independently. |
| Preferences / i18n | Hebrew/English UI resources and browser reminder preferences exist; caregiver has optional primary language | Add participant-scoped `he`/`en` communication preference. Templates receive locale and authenticated path; adding locales does not change domain events. |
| WhatsApp / SMS | No approved provider or delivery abstraction existed | Add disabled adapters and affirmative consent gates. The system reports `disabled`; it never claims delivery. |
| Delivery status / consent | None | Persist minimal intent/attempt metadata and unknown/granted/revoked consent with source/timestamps; transactional communications only. |

## Security and ownership model

Family access remains a base access role plus case responsibility assignment.
Only owner/manager application mutations may assign an active same-tenant
membership. Unassigned responsibility is represented by a null assignee and is
visible as collaboration attention; managers retain the global case-risk view.

Worker invitations store only a one-way token hash, expire, can be revoked and
are single-purpose. Activation binds the authenticated identity to exactly one
tenant/caregiver/case relationship. Worker endpoints must derive those IDs from
that active relationship. They must never accept tenant authority from request
payloads. The table RLS uses the proven `app.tenant_id` transaction context; the
application must additionally use worker-specific queries that join the active
relationship before returning worker-safe projections.

Worker document reads require both an active access relationship for the same
case and explicit worker visibility. Internal notes, AI/professional material,
private family documents and raw storage keys remain unavailable.

## Engagement pipeline

The only supported path is:

`trusted event → intent → authorized recipient → preferences/consent → localized template → provider → delivery attempt`.

Intent idempotency is tenant-scoped. Phone channels require both enablement and
`granted` consent. Email may use the production Resend adapter. WhatsApp and SMS
remain unconfigured until an approved provider and verified webhook contract
exist. No message body, credential, private document, or provider secret belongs
in intent/attempt persistence or logs; emails contain authenticated deep links.

Transactional template keys introduced for orchestration are
`task_assigned`, `worker_portal_invitation`, `worker_request_received`,
`worker_payment_available`, `worker_payment_acknowledged`, and
`important_attention`. Template version is persisted with every intent and
attempt.
