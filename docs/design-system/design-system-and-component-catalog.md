# CareDesk Design System & Component Catalog

Status: **MVP authority v1.0**
Design principles: calm, action-first, mobile-first, Hebrew RTL, accessible
Last updated: 2026-07-23

## 1. Experience principles

- One primary action per screen.
- Explain status and consequence; do not rely on color.
- Prefer short cards and guided steps over dense mobile tables.
- Sensitive information is masked by default and explains why it is needed.
- Use plain Hebrew without legal or payroll jargon.
- Preserve user input through recoverable failures.
- AI content is visually identified and never masquerades as a verified rule.

## 2. Foundations

### 2.1 Direction and layout

- Root document: `lang="he" dir="rtl"`.
- Use CSS logical properties (`margin-inline`, `padding-inline`,
  `border-inline-start`) rather than left/right assumptions.
- Mobile baseline: 360 px. Supported widths: 320–1440 px.
- Content max width: 1200 px; form reading width: 720 px.
- Mobile page padding: 16 px; tablet: 24 px; desktop: 32 px.
- Touch target minimum: 44 × 44 px.
- Primary navigation: bottom navigation on mobile, sidebar on desktop.

### 2.2 Typography

Preferred stack:

```css
font-family: "Noto Sans Hebrew", "Arial Hebrew", Arial, sans-serif;
```

| Token | Size/line | Weight | Use |
|---|---:|---:|---|
| `text-display` | 32/40 | 700 | rare page-level value |
| `text-h1` | 28/36 | 700 | page title |
| `text-h2` | 22/30 | 700 | section title |
| `text-h3` | 18/26 | 600 | card/subsection |
| `text-body` | 16/24 | 400 | default |
| `text-small` | 14/20 | 400 | metadata |
| `text-caption` | 12/18 | 500 | labels and timestamps |

Text zoom to 200% must not cause loss of content or functionality.

### 2.3 Color tokens

Tokens describe meaning, not raw color names.

| Token | Value | Use |
|---|---|---|
| `color-bg-canvas` | `#F7F8FA` | page background |
| `color-bg-surface` | `#FFFFFF` | cards and dialogs |
| `color-text-primary` | `#17202A` | body and headings |
| `color-text-secondary` | `#52606D` | supporting text |
| `color-border` | `#D9E0E7` | borders |
| `color-action` | `#1E5AA8` | primary actions |
| `color-action-hover` | `#174780` | hover |
| `color-focus` | `#7C3AED` | focus ring |
| `color-success` | `#16794B` | completed/valid |
| `color-warning` | `#9A6700` | attention soon |
| `color-danger` | `#B42318` | urgent/error |
| `color-info` | `#1769AA` | neutral information |

Each semantic status pairs color with icon, label, and accessible text.
Contrast must meet WCAG 2.1 AA.

### 2.4 Spacing, radius, elevation

Spacing scale: `4, 8, 12, 16, 24, 32, 48, 64` px.

Radius:

- inputs/buttons: 8 px;
- cards: 12 px;
- dialogs: 16 px;
- pills: 999 px.

Elevation:

- cards usually use border, not shadow;
- floating navigation: subtle level 1;
- dialogs: level 3 plus backdrop;
- urgency is never conveyed by shadow.

### 2.5 Motion

- Default duration: 160 ms; complex transition: 240 ms.
- Respect `prefers-reduced-motion`.
- Do not animate urgent status repeatedly.
- Loading skeletons must not flash faster than accessibility guidance allows.

## 3. State contract

Every data-backed screen defines:

- initial/loading;
- loaded;
- empty;
- validation error;
- recoverable service error with retry;
- permission denied;
- offline/stale if relevant;
- success confirmation.

Forms preserve values after recoverable errors. Destructive or material actions
require confirmation and show consequences.

## 4. Component construction rules

- Components live in the shared UI package only when domain-neutral.
- Feature composites stay in the owning module.
- No business rules, direct API calls, permission decisions, or hard-coded
  Hebrew strings inside visual components.
- Use typed variants rather than boolean-prop combinations.
- Forward accessible name, description, error, and focus behavior.
- Variants and states require stories/examples and component tests.

## 5. Primitive components

### Button

Variants: `primary`, `secondary`, `quiet`, `danger`, `link`.
Sizes: `sm`, `md`, `lg`, all meeting target size.
States: default, hover, focus-visible, disabled, loading, success feedback.

Loading preserves width and accessible label. Icon-only buttons require an
accessible name and tooltip where helpful.

### Icon

Use one icon library. Decorative icons are hidden from assistive technology.
Status icons are accompanied by text.

### TextField / TextArea

Contract: label, value, help text, required indicator, error, autocomplete,
input mode, sensitivity hint. Placeholder is never the only label.

### Select / Combobox

Keyboard-operable, searchable only when the option set justifies it, and
supports a clear “not found” state.

### DateField

Shows an unambiguous localized display and stores ISO date. Keyboard input and
date picker are both supported. Expiry dates include context (“28 days left”).

### MoneyField

Separates numeric value and currency, supports decimal validation, and never
uses floating-point arithmetic for business calculations.

### FileUpload

States: idle, drag/selected, validating, uploading, success, rejected, retry.
Shows file restrictions, sensitivity, privacy purpose, and that prototype data
must be synthetic. Camera capture is a mobile enhancement, not the only path.

### StatusBadge

Typed semantic status with label and optional icon. It never depends on color
alone and does not invent status names outside `SYNC_MATRIX.md`.

### Alert / InlineMessage

Variants: info, success, warning, error. Includes title, concise action, and
screen-reader announcement behavior appropriate to urgency.

### Dialog / Drawer

Focus is trapped and restored, Escape behavior is defined, title and
description are announced. On small screens, non-destructive detail views may
use a bottom sheet; critical confirmation remains a dialog.

### Skeleton / EmptyState / ErrorState

Skeleton approximates final layout. EmptyState says what is missing and offers
one next action. ErrorState distinguishes retryable, validation, authorization,
and support cases.

## 6. Navigation components

### AppShell

Provides RTL direction, skip link, authenticated header, responsive
navigation, main landmark, and global feedback region.

### MobileBottomNav

Items: Home, Tasks, Payroll, Documents, More. Active state includes text and
programmatic current-page indication.

### DesktopSidebar

Mirrors information architecture; collapse state remains keyboard accessible.

### PageHeader

Contains title, short context, optional status, and one primary action. Avoid
multiple competing buttons.

### Breadcrumbs

Used for deeper desktop flows; not a substitute for a mobile back action.

## 7. Domain-facing composites

### NextBestActionCard

Props include title key, reason, due date, priority, estimated time, source
summary, contact projection, and primary action. It shows only an authorized,
deterministically selected action.

### TaskCard

Shows status, due date, accountable/owner projection, linked workflow, relevant
contact, and one action. Deferred and blocked states show reason.

### DocumentCard

Shows document type, compliance status, expiry, verification, masked owner
data, and action. It never exposes storage URLs or full identifiers.

### ContactCard

Shows name, role, organization, availability, preferred channel, primary/
backup/emergency labels, and why the contact is relevant. A contact card does
not imply system access.

### OrganizationCard

Shows type, service areas, current active contacts, hours, and emergency
channel.

### PayrollSummary

Shows period, status, gross/adjustments/payment-record summary, explanation
entry point, verification state, and approval action. Every amount has a
traceable component list.

### PayrollLineItem

Shows component, quantity, rate, amount, rule/source link, confidence, and
override state/reason.

### TimelineEvent

Shows occurred time, event label, source module, concise summary, actor
projection, sensitivity indicator, and link to source. It is distinct from an
AuditEvent.

### CommunicationEntryCard

Shows parties, channel, date, purpose, outcome, confirmation, follow-up, and
visibility.

### AIAnswer

Required regions: direct answer, explanation, recommended action, relevant
contact, sources, confidence, disclaimer, and escalation. AI output is labeled
and cannot render an unverified claim as a success status.

## 8. Process components

### Wizard

Contract:

- persistent title and progress;
- one coherent decision per step;
- Back/Next with preserved input;
- summary before material submission;
- recoverable save failure;
- exit/resume support where appropriate;
- no hidden completion when a step is skipped.

### Stepper

Uses ordered semantics, current/completed/blocked labels, and text equivalents.

### RACIEditor

Prevents activation without exactly one accountable and at least one
responsible assignment. It distinguishes Contact from User and explains that
assignment does not grant access.

### NotificationMatrix

Columns/fields: recipient, reason, requirement level, source, channel, owner,
due date, status, confirmation required, and action. On mobile, it renders as
stacked cards rather than a horizontal table.

### WorkflowStatus

Displays template version, current step, blockers, next action, and source
context. It does not calculate transitions in the component.

## 9. Sensitive-data components

### MaskedValue

Shows minimal suffix only where justified. Reveal requires permission,
step-up authentication when configured, explicit action, timeout/remasking,
and AuditEvent.

### SensitiveFieldNotice

Explains purpose, visibility, retention status, and sharing behavior before
collection.

### PermissionGate

Renders authorized child content or a safe denied state. It improves UX but is
never the security boundary; server and RLS checks remain mandatory.

## 10. Screen patterns

### Dashboard

Order:

1. greeting and overall status;
2. Next Best Action;
3. visa, insurance, payroll, and document cards;
4. relevant contact;
5. recent Timeline;
6. AI suggestions.

### Center/list screens

Use filter chips, search where needed, clear counts, cards on mobile, and
bounded tables only on desktop when comparison materially helps.

### Detail screens

Lead with identity/status, then next action, summary, related records,
Timeline, and audit-safe metadata. Sensitive data stays collapsed/masked.

## 11. Content language

- Use “נדרשת בדיקה מקצועית” when evidence or approval is insufficient.
- Do not say “החוק מחייב” without a verified applicable rule and visible
  source.
- Use calm action labels such as “בדיקה”, “המשך”, “תיעוד פנייה”.
- Error messages say what happened, what was preserved, and what to do next.
- Dates and currency are localized; stored values remain canonical.

## 12. Accessibility acceptance

Every component and screen must pass:

- keyboard-only operation;
- visible focus;
- correct landmarks and headings;
- accessible names/descriptions/errors;
- contrast;
- status not based on color alone;
- 200% text zoom;
- RTL screen-reader order;
- touch target size;
- reduced motion;
- modal focus restoration.

Critical MVP journeys require automated accessibility checks plus manual
keyboard and screen-reader smoke tests.

## 13. Catalog governance

Before creating a component:

1. search this catalog and the codebase;
2. decide primitive, composite, or feature-local ownership;
3. define typed contract and all states;
4. add translation keys;
5. add examples and tests;
6. record any new shared status in `SYNC_MATRIX.md`;
7. obtain design-system review for a new shared primitive.
