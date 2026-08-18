# CareDesk — תוכנית יישום PR

**גרסה:** 1.0  
**נכתב:** 2026-07-25  
**מסמכי סמכות שנקראו:** SOURCE_OF_TRUTH, Database Blueprint, Design System & Component Catalog, User Stories & Acceptance Criteria, AI Review Constitution, ADR-001, ADR-003, Rules & Workflow Engine, AI Coding Constitution v1.0  
**מצב עץ המקור:** נסרק באמצעות `git ls-tree -r --name-only main`  

---

## הקשר ומצב הבסיס

הרפוזיטורי הוא monorepo מבוסס `pnpm workspaces`. המבנה הקיים:

- **`apps/web`** — Vite + React, נתיבים קיימים: `/` (DashboardPage), `/cases/new` (OpenCasePage), `/cases/:caseId` (CasePage)
- **`apps/api`** — שרת Fastify עם Supabase/Postgres
- **`packages/ui`** — קומפוננטות shared: `Button`, `StatusBadge`, `Alert`, `EmptyState`, `ErrorState`, `Skeleton`, `TextField`
- **`packages/design-tokens`** — `tokens.css` + `tokens.ts` (מסונכרנים דרך `tokens.sync.test.ts`)
- **`packages/i18n`** — `he.json` + `en.json`, מפתחות קיימים: `app`, `shell`, `nav`, `case`, `contacts`, `tasks`, `documents`, `timeline`
- **`packages/domain`** — entities, IDs, status transitions
- **`packages/application`** — use-cases, ports (כולל `workflow-repository`, `rule-repository`)
- **`packages/db`** — migrations 0001–0009, repositories
- **`packages/workflows`** — state-machine
- **`packages/rules`** — evaluator

**מה חסר:**
- `MobileBottomNav` ו-`DesktopSidebar` (AppShell קיים אך ריק מניווט)
- `TaskRow` primitive ב-`packages/ui`
- מסכי Calendar, Documents (עצמאי), VisaRenewal, wizard פתיחת תיק משופר
- migration לסכמת workflow/cycle
- מפתחות i18n לניווט, לוח שנה, חידוש אשרה

**אילוצי ברזל (מהחוקה וה-ADRs):**
- `lang="he" dir="rtl"` ברמת המסמך (קיים ב-`apps/web/index.html`)
- CSS logical properties בלבד (`margin-inline`, `padding-inline`, `border-inline-start`)
- מינימום touch target: 44×44 px
- אין Hebrew hardcoded בקומפוננטות — הכל מ-`useTranslation()`
- `MockAIProvider` בלבד עד שאישורי ADR-003 יושלמו
- אין העתקת קוד מ-`caredesk_prototype.html`
- כל שינוי עובר: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

---

## PR-0 — ארגז כלים עיצוב: השלמת טוקנים ו-typography tokens

### כותרת
`feat(design-tokens): השלמת scale טיפוגרפיה, breakpoints, z-index ו-font-face לעברית`

### תיאור
`packages/design-tokens` מכיל כרגע `--color-*`, `--space-*`, `--radius-*`, `--motion-*`. חסרים עדיין טוקנים שה-Design System §2.2, §2.4 מגדיר: כל ה-`--text-*` CSS custom properties כבר קיימים ב-`tokens.css`, אך **`tokens.ts` חסר את ה-typography keys** לחלוטין (`colorTokens` קיים, `spacingTokens` קיים, `radiusTokens` קיים, `motionTokens` קיים — אך אין `typographyTokens`). בנוסף חסרים: breakpoint tokens, z-index scale, ו-Noto Sans Hebrew font-face declaration.

PR זה הוא **תנאי מוקדם לכל PR אחר** — ללא token set שלם, קומפוננטות PR-2 עד PR-9 ייצרו טוקנים לא מסונכרנים.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `packages/design-tokens/src/tokens.css` | הוספת `--text-*` (כבר קיים) + `--breakpoint-*`, `--z-index-*`, `@font-face` ל-Noto Sans Hebrew |
| `packages/design-tokens/src/tokens.ts` | הוספת `typographyTokens`, `breakpointTokens`, `zIndexTokens` — כרפלקציה של `tokens.css` |
| `packages/design-tokens/src/tokens.sync.test.ts` | הרחבת assertion לכסות את הקבוצות החדשות |
| `packages/design-tokens/src/index.ts` | export של הקבוצות החדשות |
| `apps/web/src/global.css` | הוספת `@import` של font-face אם לא מוגדר כ-CSS variable |
| `docs/design-system/design-system-and-component-catalog.md` | עדכון טבלת טוקנים (אם נוסף טוקן שאינו מוזכר כרגע) |

### ערכי קצה (breakpoints)
```css
--breakpoint-mobile: 360px;
--breakpoint-tablet: 768px;
--breakpoint-desktop: 1024px;
--breakpoint-wide: 1200px;
```

### z-index scale
```css
--z-index-base: 0;
--z-index-nav: 100;
--z-index-drawer: 200;
--z-index-dialog: 300;
--z-index-toast: 400;
```

### קריטריוני קבלה
- [ ] `tokens.sync.test.ts` עובר — אין drift בין `tokens.css` ל-`tokens.ts`
- [ ] כל `--text-*` property קיים ב-CSS ומשוקף ב-TS
- [ ] Noto Sans Hebrew נטען ב-`apps/web` ומאומת בבדיקת visual smoke
- [ ] אין ערכי צבע/מרווח hardcoded חדשים מחוץ ל-`tokens.css`
- [ ] `SYNC_MATRIX.md` עודכן בשורה "Design token"

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (tokens.sync.test.ts חייב לעבור)
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] Noto Sans Hebrew מוצג נכון ב-Chrome/iOS Safari בעברית
- [ ] גופן נטען גם ב-offline (self-hosted או bundled) — לא CDN בלבד
- [ ] אין שינוי ב-layout בעת zoom 200%

### תלויות
אין — זה ה-PR הראשון.

---

## PR-1 — DB migration: סכמת workflow, cycle ו-immigration_authorization

### כותרת
`feat(db): migration 0010 — workflow_template, workflow_instance, workflow_step, immigration_authorization`

### תיאור
Migrations 0001–0009 קיימים וכוללים `task`, `timeline_event`, `audit_event`, `document`, `document_version`. **חסר לחלוטין:** `workflow_template`, `workflow_template_version`, `workflow_instance`, `workflow_step`, `responsibility_assignment`, `notification_requirement`, `notification_delivery`, ו-`immigration_authorization` (הגדרה שיש לה רק `document` שמצביע עליה, אך הישות עצמה אינה מוגדרת ב-schema).

PR זה כולל שני migrations נפרדים:
- **`0010_immigration_and_insurance.sql`** — `immigration_authorization` + `medical_insurance_policy` (מוזכרים ב-Database Blueprint §4.3 ונדרשים ל-PR-8)
- **`0011_workflow_engine.sql`** — `workflow_template`, `workflow_template_version`, `workflow_instance`, `workflow_step`, `responsibility_assignment`, `notification_requirement`, `notification_delivery`

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `database/migrations/0010_immigration_and_insurance.sql` | יצירה חדשה |
| `database/migrations/0011_workflow_engine.sql` | יצירה חדשה |
| `packages/db/src/index.ts` | export repository interfaces חדשים |
| `packages/domain/src/entities.ts` | הוספת `ImmigrationAuthorization`, `WorkflowInstance`, `WorkflowStep` domain types |
| `packages/domain/src/ids.ts` | branded IDs: `WorkflowInstanceId`, `WorkflowStepId`, `ImmigrationAuthorizationId` |
| `packages/application/src/ports/workflow-repository.ts` | קיים — סקירה ועדכון לפי schema ממשי |
| `packages/schemas/src/employment-case.ts` | הרחבת response לכלול `immigrationAuthorizations[]` |
| `packages/testing/src/fixtures.ts` | fixtures סינתטיים ל-workflow ול-immigration_authorization |
| `database/README.md` | עדכון migration log |

### schema מרכזי (immigration_authorization)
```sql
-- tenant_id + employment_case_id + RLS בהתאם ל-migration 0004
-- שדות: authorization_type, document_number_encrypted, issuer,
--        valid_from, valid_to, status, verification_status,
--        current_document_version_id
-- status enum: draft, active, expired, superseded, cancelled
-- ללא hard-coded dates
```

### קריטריוני קבלה
- [ ] `pnpm db:migrate` עובר ב-Docker Compose (`database/docker-compose.yml`)
- [ ] RLS מופעל על כל טבלה חדשה (כ-migration 0004)
- [ ] אין legal constant hardcoded (ללא מספר ימים לחידוש בתוך SQL)
- [ ] `database/rls-test-harness-design.md` מתייחס לישויות החדשות
- [ ] cross-tenant FK נחסם ב-constraint
- [ ] fixtures: לפחות 2 workflows סינתטיים, לפחות 2 immigration_authorization רשומות

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (fixtures.test.ts + domain/status.test.ts)
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
לא רלוונטי — PR זה הוא backend/DB בלבד.

### תלויות
תלוי ב-**PR-0** (tokens) — אין תלות ישירה, אך על-פי convention הרפוזיטורי PR-0 ממוזג ראשון.

---

## PR-2 — App Shell: MobileBottomNav, DesktopSidebar, RTL מלא

### כותרת
`feat(web): AppShell — MobileBottomNav, DesktopSidebar, skip-link, RTL logical properties`

### תיאור
`AppShell.tsx` הנוכחי הוא stub: header פשוט + `<nav>` עם שני NavLink. Design System §6 מגדיר `MobileBottomNav` (Items: Home, Tasks, Payroll, Documents, More) ו-`DesktopSidebar`. הפרוטוטיפ מראה 5 פריטי ניווט תחתי: ראשי (dashboard), תיק (worker/case), לוח שנה (calendar), מסמכים (documents), עוד (more/settings).

PR זה מממש את ה-AppShell המלא ומוסיף 3 נתיבים חדשים (ריקים): `/calendar`, `/documents`, `/more`.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `apps/web/src/AppShell.tsx` | מימוש מלא עם skip-link, `<header>`, `MobileBottomNav` / `DesktopSidebar`, `<main>` |
| `apps/web/src/components/MobileBottomNav.tsx` | יצירה חדשה — קומפוננטה domain-neutral |
| `apps/web/src/components/DesktopSidebar.tsx` | יצירה חדשה |
| `apps/web/src/App.tsx` | הוספת נתיבים `/calendar`, `/documents`, `/more` |
| `apps/web/src/pages/CalendarPage.tsx` | stub ריק עם EmptyState |
| `apps/web/src/pages/DocumentsPage.tsx` | stub ריק עם EmptyState |
| `apps/web/src/pages/MorePage.tsx` | stub ריק |
| `apps/web/src/global.css` | bottom-nav height CSS variable, safe-area-inset |
| `packages/i18n/src/resources/he.json` | מפתחות: `nav.today`, `nav.case`, `nav.calendar`, `nav.documents`, `nav.more` |
| `packages/i18n/src/resources/en.json` | אותם מפתחות באנגלית |
| `apps/web/src/App.test.tsx` | בדיקת רנדור RTL, landmark structure, skip-link |

### פרטי מימוש קריטיים
- `MobileBottomNav` משתמש ב-`<nav aria-label={t('shell.primaryNavigation')}>` עם `<ul>` + `<li>`
- כל item: `<NavLink>` עם `aria-current="page"` כשפעיל
- גובה: `--bottom-nav-height: 64px` כ-CSS variable (לא hardcoded ב-layout)
- padding-bottom ב-`<main>`: `calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))`
- `DesktopSidebar` מוצג רק מעל `--breakpoint-desktop` דרך CSS `@media`
- **אין** boolean props כמו `isMobile` — CSS בלבד שולט על ה-display
- כל padding/margin: logical properties (`padding-inline-start`, לא `padding-left`)
- icon: Lucide React (כבר מאושר בחוקה §3 Frontend)
- Icons עם משמעות כיוונית: `mirror-rtl` class דרך token

### קריטריוני קבלה
- [ ] `<html lang="he" dir="rtl">` ב-`index.html` (קיים — לא לשנות)
- [ ] skip-link גלוי בעת focus מקלדת
- [ ] `<main id="main-content">` נגיש ומתויג
- [ ] `aria-current="page"` על הפריט הפעיל
- [ ] 44×44 px לכל נקודת מגע בניווט — בדיקה ב-DevTools
- [ ] Bottom nav לא חוסם תוכן (safe-area-inset)
- [ ] Sidebar קריס ונגיש ב-keyboard
- [ ] `apps/web/e2e/smoke.spec.ts` עובר (navigation smoke)

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓
pnpm test:a11y      ✓  (axe: no violations על AppShell)
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל (טלפון אמיתי)
- [ ] bottom nav מוצג תחתון בצד נכון ב-iOS Safari (בדיקה על אייפון)
- [ ] bottom nav מוצג תחתון ב-Android Chrome
- [ ] הפריט הפעיל מאוּר ב-RTL (icon בצד ימין של הtext, לא שמאל)
- [ ] Sidebar קורס/נפתח בלי horizontal scroll
- [ ] גלילה אנכית לא נחסמת ע"י nav
- [ ] dev server נגיש מהטלפון (כפי שהוגדר ב-commit האחרון — VITE_HOST=0.0.0.0)

### תלויות
תלוי ב-**PR-0**.

---

## PR-3 — TaskRow primitive ב-`@caredesk/ui`

### כותרת
`feat(ui): TaskRow — primitive component לשורת משימה ב-packages/ui`

### תיאור
Design System §7 מגדיר `TaskCard` עם status, due date, accountable/owner, linked workflow, ופעולה אחת. PR-4 (Today) ו-PR-5 (Case File) שניהם ישתמשו בו. עם זאת, Design System §4 קובע: "Components live in the shared UI package **only when domain-neutral**". `TaskRow` הוא domain-neutral (מקבל props, לא מבצע API calls), בשונה מ-`CaseTasksSection` שהוא feature composite.

**`TaskRow` ≠ `TaskCard` מלא** — PR-3 מממש את ה-primitive שורה. `TaskCard` שדורש בחירת contact ו-workflow link יממש PR-5.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `packages/ui/src/TaskRow.tsx` | יצירה חדשה |
| `packages/ui/src/TaskRow.css` | סטיילינג עם CSS variables בלבד |
| `packages/ui/src/TaskRow.test.tsx` | unit + accessibility tests |
| `packages/ui/src/index.ts` | export של `TaskRow` |
| `packages/i18n/src/resources/he.json` | מפתחות `tasks.dueLabel`, `tasks.blockedReason`, `tasks.deferredUntil` אם חסרים |

### contract הקומפוננטה
```typescript
export interface TaskRowProps {
  title: string;               // כבר מתורגם ע"י הצרכן
  status: TaskStatus;          // 'open' | 'in_progress' | 'blocked' | 'completed' | 'deferred' | 'cancelled'
  priority: TaskPriority;      // 'low' | 'normal' | 'high' | 'urgent'
  dueAt?: string;              // ISO string — מתורגם לתצוגה ב-component
  deferredUntil?: string;
  deferReason?: string;
  onAction?: () => void;
  actionLabel?: string;        // תרגום חיצוני
  isLoading?: boolean;
}
```

- `TaskStatus` ו-`TaskPriority` ייובאו מ-`packages/domain` (לא יוגדרו מחדש)
- תאריכים: `Intl.DateTimeFormat('he-IL')` — לא hardcoded format
- צבע priority: דרך `StatusBadge` tone בלבד (לא color hardcoded)
- אין Hebrew strings בתוך הקומפוננטה — props בלבד

### קריטריוני קבלה
- [ ] `TaskRow.test.tsx`: renders all 6 statuses, priority badges, due date
- [ ] `TaskRow.test.tsx`: `toHaveNoViolations()` (axe)
- [ ] 44×44 px ל-action button
- [ ] RTL: icon ותאריך מסודרים לוגית (לא left/right hardcoded)
- [ ] Deferred state: מציג `deferReason` ו-`deferredUntil`
- [ ] Completed state: visual struck-through או dimmed (דרך token בלבד)
- [ ] Status not conveyed by color alone (icon + label נוסף)
- [ ] `packages/ui` build עובר

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (TaskRow.test.tsx, packages/ui/vitest.config.ts)
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] status icon לא מתהפך ב-RTL (אייקונים סטטוס אינם כיוונאיים)
- [ ] תאריך: פורמט עברי נכון (dd/mm/yyyy או "28 ביולי")
- [ ] action button נגיש בטלפון: 44px בדיוק

### תלויות
תלוי ב-**PR-0** (tokens), **PR-2** (i18n keys pattern).

---

## PR-4 — מסך "היום" (Dashboard)

### כותרת
`feat(web): DashboardPage — כרטיסי סטטוס, NextBestAction, ציר זמן ראשוני`

### תיאור
`DashboardPage.tsx` הנוכחי הוא Milestone 0 stub שמציג health check ו-`EmptyState`. PR זה מממש את מסך "היום" לפי Design System §10 (Dashboard) ו-User Story CD-F1-08 + CD-F1-09. הסדר במסך (לפי Design System):
1. ברכה + סטטוס כללי
2. NextBestActionCard
3. כרטיסי visa, insurance, payroll, documents
4. איש קשר רלוונטי
5. ציר זמן אחרון
6. AI suggestions (MockAIProvider — CD-F6-01)

**בשלב זה**: items 3–6 מציגים מה שה-API מחזיר. MockAIProvider משמש עבור item 6.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `apps/web/src/pages/DashboardPage.tsx` | מימוש מלא |
| `apps/web/src/components/NextBestActionCard.tsx` | יצירה — feature composite (לא ב-packages/ui) |
| `apps/web/src/components/StatusSummaryCard.tsx` | כרטיס סטטוס לאשרה/ביטוח/שכר |
| `apps/web/src/components/DashboardTimeline.tsx` | ציר זמן קצר (3–5 events) |
| `apps/web/src/hooks/useDashboard.ts` | TanStack Query hook לטעינת dashboard projection |
| `apps/api/src/routes/dashboard.ts` | endpoint `GET /dashboard` שמחזיר projection |
| `apps/api/src/routes/dashboard.ts` | (test) `dashboard.test.ts` |
| `packages/schemas/src/dashboard.ts` | Zod schema: `DashboardResponse` |
| `packages/schemas/src/index.ts` | export |
| `packages/i18n/src/resources/he.json` | מפתחות: `dashboard.greeting`, `dashboard.noCase`, `dashboard.visaStatus`, `dashboard.insuranceStatus`, `dashboard.nextAction` |
| `packages/infrastructure/src/mocks/mock-ai-provider.ts` | הוספת mock response לdashboard query |

### `DashboardResponse` schema (קצר)
```typescript
{
  hasActiveCase: boolean;
  greeting: string;              // from name projection
  nextBestAction?: { ... };
  visaStatus?: { expiresAt: string; daysLeft: number; status: string };
  insuranceStatus?: { expiresAt: string; status: string };
  recentTimeline: TimelineEventProjection[];
  aiSuggestion?: { answer: string; confidence: string; disclaimer: string; sources: string[] };
}
```

- endpoint מוגן ב-authentication (plugin `authenticate.ts` קיים)
- deny-by-default: tenant isolation דרך `TenantMembership`
- sensitive values (מספר דרכון, בנק): לא בתשובת dashboard
- `aiSuggestion` מגיע תמיד מ-`MockAIProvider` ומתויג בבירור

### קריטריוני קבלה
- [ ] CD-F1-08: משימות דחופות מוצגות בראש
- [ ] CD-F1-09: ציר זמן, link לרשומת המקור
- [ ] CD-F6-01: AI suggestion מתויג ויש disclaimer
- [ ] loading skeleton מאכלס את layout עד לטעינה
- [ ] empty state כשאין תיק פעיל (EmptyState עם CTA לפתיחת תיק)
- [ ] error state עם retry
- [ ] denied state כשאין membership
- [ ] אין sensitive data בתגובת ה-API (`console.log` / audit לא כולל passport/bank)

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (dashboard.test.ts, DashboardPage.test.tsx)
pnpm test:a11y      ✓
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] NextBestActionCard: כפתור הפעולה הראשית מוצב בצד שמאל (RTL = inline-start)
- [ ] status cards: עמודה בודדת ב-360px, שתי עמודות ב-tablet
- [ ] ציר זמן: כיוון כרונולוגי מימין לשמאל
- [ ] גלילה אנכית חלקה; bottom nav לא חוסם
- [ ] **טלפון אמיתי**: NextBestActionCard לחיץ בכל שטחו (44px min)

### תלויות
תלוי ב-**PR-0, PR-1, PR-2, PR-3**.

---

## PR-5 — מסך תיק ההעסקה (CasePage מלא)

### כותרת
`feat(web): CasePage — PageHeader, TaskCard, DocumentCard, ContactCard, Timeline, workflow status`

### תיאור
`CasePage.tsx` הנוכחי מציג `<dl>` בסיסי + 4 sections (Tasks, Documents, Contacts, Timeline) כ-stubs. PR זה מממש את ה-"Case File Screen" (תיק) לפי Design System §10 (Detail screens) ו-Epics F1, F2.

**אין כאן מימוש של workflow חידוש אשרה** — זה PR-8. כאן: הצגת WorkflowStatus של workflow פעיל (אם קיים).

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `apps/web/src/pages/CasePage.tsx` | refactor מלא |
| `apps/web/src/components/PageHeader.tsx` | יצירה — title, status badge, primary action |
| `apps/web/src/components/WorkflowStatusBadge.tsx` | מציג template name, current step, blockers |
| `apps/web/src/pages/case/CaseTasksSection.tsx` | עדכון: שימוש ב-`TaskRow` מ-PR-3, defer/complete actions |
| `apps/web/src/pages/case/CaseDocumentsSection.tsx` | עדכון: DocumentCard עם expiry, verification_status, masked storage URL |
| `apps/web/src/pages/case/CaseContactsSection.tsx` | עדכון: ContactCard עם role, primary/emergency badges |
| `apps/web/src/pages/case/CaseTimelineSection.tsx` | עדכון: filter chips (task/document/contact/workflow) |
| `apps/web/src/hooks/useCaseTasks.ts` | TanStack Query — task mutations (complete, defer) |
| `apps/api/src/routes/cases.ts` | `PATCH /cases/:id/tasks/:taskId` — complete/defer |
| `packages/schemas/src/case-tasks.ts` | schema לבקשת defer (reason + deferredUntil) |
| `packages/i18n/src/resources/he.json` | מפתחות: `case.workflowStatus`, `case.activeWorkflow`, `case.deferTask`, `case.completeTask`, `case.deferReason`, `documents.maskedUrl` |

### פרטי מימוש קריטיים — sensitive data
- `DocumentCard`: **אין** href לקובץ Storage ב-DOM. לחיצה → API call → signed URL קצר-מועד → `window.open`
- `CaseContactsSection`: Contact ≠ User. הצגת `isPrimary`, `isEmergency`, לא `userId`
- `MaskedValue` (מ-Design System §9): passport_number, bank_account — masked בברירת מחדל

### קריטריוני קבלה
- [ ] CD-F1-07: DocumentCard מציג compliance_status, verification_status, expires_at
- [ ] CD-F1-08: defer task דורש reason + deferredUntil; UI שומר form input בכישלון
- [ ] CD-F1-09: timeline מאפשר filter; sensitive events מכוסים לפי permission
- [ ] CD-F1-10: cross-tenant request נדחה (בדיקת API)
- [ ] `PATCH` endpoint בודק membership + case ownership server-side
- [ ] AuditEvent נוצר ב-task completion דרך `audit-service.ts`

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (CaseTasksSection.test.tsx, CaseDocumentsSection.test.tsx, API integration)
pnpm test:a11y      ✓
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] `PageHeader`: כפתור primary action בצד שמאל (inline-start ב-RTL)
- [ ] `CaseContactsSection`: כרטיסי איש קשר — stack ב-mobile, grid ב-desktop
- [ ] `CaseTimelineSection`: filter chips גוללים אופקית ב-360px ללא overflow
- [ ] `DocumentCard`: expiry date בעברית ("תוקף עד 15 בספטמבר")
- [ ] **טלפון אמיתי**: defer task: bottom sheet נסגר בבצוע swipe down

### תלויות
תלוי ב-**PR-0, PR-1, PR-2, PR-3, PR-4**.

---

## PR-6 — מסך לוח שנה

### כותרת
`feat(web): CalendarPage — תצוגת אירועים ומועדי יעד, RTL week grid`

### תיאור
`CalendarPage.tsx` הוא כרגע stub ריק (נוצר ב-PR-2). PR זה מממש תצוגת לוח שנה עם: deadline משימות, תפוגת אשרה, תפוגת ביטוח, payroll deadlines — הכל מאובטח ב-tenant context.

**חשוב:** אין שימוש בספריית calendar חיצונית ללא ADR. יש לממש grid CSS פשוט **או** להגיש ADR קטן ב-PR description. Default: CSS Grid RTL.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `apps/web/src/pages/CalendarPage.tsx` | מימוש מלא |
| `apps/web/src/components/CalendarGrid.tsx` | week/month grid, RTL day order (ראשון מימין = ראשון) |
| `apps/web/src/components/CalendarEventChip.tsx` | chip צבעוני לפי priority, עם text fallback |
| `apps/web/src/hooks/useCalendarEvents.ts` | TanStack Query — אגרגציה של tasks + deadlines |
| `apps/api/src/routes/calendar.ts` | `GET /calendar?from=&to=` — projection aggregated |
| `packages/schemas/src/calendar.ts` | Zod: `CalendarEventResponse[]` |
| `packages/i18n/src/resources/he.json` | מפתחות: `calendar.heading`, `calendar.today`, `calendar.noEvents`, `calendar.taskDue`, `calendar.visaExpiry`, `calendar.insuranceExpiry` |

### פרטי מימוש קריטיים
- שבוע מתחיל ב**ראשון** (ישראל) — `Intl.Locale` locale week info
- column headers: "א׳", "ב׳"... לא hardcoded
- ניווט חודש: כפתורי `›` ו-`‹` **מתהפכים ב-RTL** (logical: forward = inline-end)
- event chip: status not color-only (icon + label)
- לחיצה על event: navigate לתיק הרלוונטי

### קריטריוני קבלה
- [ ] שבוע מתחיל ראשון, headers עבריים
- [ ] RTL: כפתור "הבא" בצד ימין
- [ ] empty state בשבוע/חודש ריק
- [ ] loading skeleton בצורת grid
- [ ] event click → navigate to CasePage
- [ ] ניווט מקלדת: Tab + Enter על events
- [ ] 44×44 px לכפתורי ניווט

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (CalendarGrid.test.tsx — RTL week order, empty state)
pnpm test:a11y      ✓
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] **טלפון אמיתי**: grid מוצג ב-360px ללא overflow
- [ ] swipe אופקי לניווט בין חודשים (enhancement, לא תנאי מוקדם)
- [ ] event chips נקראים ב-VoiceOver/TalkBack

### תלויות
תלוי ב-**PR-0, PR-1, PR-2** (AppShell + routes).

---

## PR-7 — מסך מסמכים

### כותרת
`feat(web): DocumentsPage — רשימת מסמכים מרוכזת, filter, upload`

### תיאור
`DocumentsPage.tsx` הוא stub מ-PR-2. PR זה ממש את מסך המסמכים העצמאי (לא section בתוך CasePage). מציג את כל המסמכים של הtenant הנוכחי — passport, visa, contract, insurance, payroll — עם filter chips לפי document_type ו-compliance_status.

שימוש ב-`FileUpload` (Design System §5) לאפשרות העלאת מסמך חדש. רלוונטי ל-CD-F1-07.

### קבצים שמשתנים

| קובץ | פעקולה |
|---|---|
| `apps/web/src/pages/DocumentsPage.tsx` | מימוש מלא |
| `apps/web/src/components/DocumentCard.tsx` | עצמאי (feature composite, לא ב-packages/ui) |
| `apps/web/src/components/FileUploadDialog.tsx` | Dialog + FileUpload primitive |
| `packages/ui/src/FileUpload.tsx` | יצירה חדשה — primitive domain-neutral |
| `packages/ui/src/FileUpload.css` | |
| `packages/ui/src/FileUpload.test.tsx` | states: idle, drag, validating, uploading, success, rejected, retry |
| `packages/ui/src/index.ts` | export |
| `packages/i18n/src/resources/he.json` | מפתחות: `documents.filterAll`, `documents.filterPassport`, `documents.uploadNew`, `documents.expiringWarning`, `documents.expiredDanger` |

### `FileUpload` contract (primitive)
```typescript
interface FileUploadProps {
  accept: string[];            // ['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
  maxSizeBytes: number;
  sensitivityHint: string;     // מחוץ לקומפוננטה — prop מתורגם
  privacyPurpose: string;      // מה הקובץ ישמש לו
  onFileSelected: (file: File) => void;
  uploadState: UploadState;    // discriminated union
}
```

- Camera capture כ-`accept="image/*" capture="environment"` — mobile enhancement
- אזהרת נתונים סינתטיים מוצגת תמיד ב-prototype mode (`VITE_PROTOTYPE_MODE=true`)
- לא מבצע API call — הצרכן (feature composite) אחראי

### קריטריוני קבלה
- [ ] CD-F1-07: upload יוצר `DocumentVersion` חדש, לא מחליף ישן
- [ ] FileUpload: 7 states, כולם מכוסים בטסט
- [ ] drag-and-drop + click + camera ב-mobile
- [ ] filter chips: לפחות document_type + compliance_status
- [ ] storage URL: לא מוצג ב-DOM — קריאת API לsigned URL בלחיצה
- [ ] prototype warning מוצג בהעלאה

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (FileUpload.test.tsx, DocumentsPage.test.tsx)
pnpm test:a11y      ✓
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] **טלפון אמיתי**: drag zone נגישה (tap to browse)
- [ ] camera capture עובד ב-iOS Safari
- [ ] filter chips גוללים אופקית, לא נחתכים
- [ ] sensitivity hint מוצג לפני בחירת קובץ

### תלויות
תלוי ב-**PR-0, PR-2, PR-5** (DocumentCard pattern).

---

## PR-8 — מסך חידוש אשרה (VisaRenewal)

### כותרת
`feat(web): VisaRenewalScreen — workflow חידוש אשרה, RACI, contact blocker, document upload`

### תיאור
זהו ה-MVP workflow הקריטי הראשון (Rules & Workflow Engine §11). PR זה מממש את ה-UI עבור:
- זיהוי visa שמתקרב לתפוגה (trigger מ-Rule evaluation)
- הצגת WorkflowInstance עם הסבר "מדוע קיימת המשימה"
- שלבי ה-workflow (Steps 1–10 מ-§11)
- contact blocker (אם אין licensed-bureau contact)
- העלאת DocumentVersion חדש לאשרה
- יצירת `ImmigrationAuthorization` חדשה

**UI בלבד — לא ה-Rules Engine.** ה-Rules Engine (`packages/rules/src/evaluator.ts`) עובד, PR זה מחבר אותו ל-API endpoint ול-UI.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `apps/web/src/pages/VisaRenewalPage.tsx` | יצירה חדשה |
| `apps/web/src/components/WorkflowStepsView.tsx` | תצוגת שלבי workflow (Stepper) |
| `apps/web/src/components/RACIAssignmentSection.tsx` | הצגת RACI, לא RACIEditor מלא (P1) |
| `apps/web/src/components/ContactBlockerAlert.tsx` | Alert כשחסר licensed-bureau contact |
| `apps/web/src/components/ImmigrationAuthorizationForm.tsx` | טופס יצירת authorization חדשה |
| `apps/web/src/hooks/useVisaRenewal.ts` | TanStack Query mutations |
| `apps/api/src/routes/visa-renewal.ts` | endpoints: `POST /cases/:id/visa-renewal`, `GET /cases/:id/visa-renewal/:instanceId`, `POST .../steps/:stepId/complete` |
| `apps/api/src/routes/visa-renewal.test.ts` | integration tests: happy path, missing contact blocker, overlapping authorization |
| `packages/schemas/src/visa-renewal.ts` | Zod schemas |
| `packages/application/src/use-cases/` | `start-visa-renewal.ts`, `complete-visa-renewal-step.ts` (use-cases חדשים) |
| `packages/i18n/src/resources/he.json` | מפתחות: `visa.renewalHeading`, `visa.whyThisExists`, `visa.sourceReference`, `visa.missingContact`, `visa.addBureau`, `visa.newAuthorization`, `visa.overlapWarning`, `visa.complete` |

### פרטי מימוש קריטיים
- Rule version ID ו-source reference מוצגים ב-UI (Design System §7 NextBestActionCard)
- "מדוע קיים workflow" — טקסט מגיע מ-`explanation_template` של ה-RuleVersion
- Due date: מגיע מה-Rule output, **לא מ-UI constant**
- Overlap: שתי authorizations פעילות → `alert(warning)`, לא חסימה מיידית
- `MockAIProvider`: אפשרות "Draft message to bureau" ב-step 5 (CD-F6-02, P1 — stub בלבד)
- כשהworkflow מסתיים: Timeline + AuditEvent נוצרים דרך `timeline-service.ts` ו-`audit-service.ts` (לא ישירות מה-UI)

### קריטריוני קבלה
- [ ] CD-F2-01: task נוצר רק מ-active RuleVersion
- [ ] CD-F2-02: WorkflowInstance מחובר ל-WorkflowTemplateVersion; RACI valid
- [ ] CD-F2-03: CommunicationEntry נרשם (channel, outcome, follow-up)
- [ ] CD-F2-04: new ImmigrationAuthorization record; historical לא נמחק; overlap → review
- [ ] CD-F2-05: completion gate — required steps + verification
- [ ] API: `POST visa-renewal` נדחה ללא active membership
- [ ] AuditEvent נוצר ב-workflow start + completion

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (use-cases unit, API integration, UI component)
pnpm test:a11y      ✓
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] WorkflowStepsView: Stepper ב-RTL (מסומן מימין לשמאל)
- [ ] ContactBlockerAlert: CTA ל"הוספת תאגיד מורשה" נגיש
- [ ] ImmigrationAuthorizationForm: date fields — `<input type="date">` עם LTR direction בתוך RTL layout
- [ ] **טלפון אמיתי**: טופס authorization — scroll לשדה error
- [ ] **טלפון אמיתי**: upload document (מ-FileUpload PR-7) + preview

### תלויות
תלוי ב-**PR-0, PR-1, PR-2, PR-3, PR-5, PR-7**.

---

## PR-9 — אשף פתיחת תיק (OpenCase Wizard)

### כותרת
`feat(web): OpenCasePage — wizard מלא עם שלבי recipient, employer, caregiver, RACI, summary`

### תיאור
`OpenCasePage.tsx` קיים ומממש טופס בסיסי לפי Milestone 0. PR זה מרחיב אותו ל-wizard מלא לפי Design System §8 (Wizard) ו-User Stories CD-F1-01 עד CD-F1-06.

שלבי ה-wizard:
1. **פרטי מטופל** (CareRecipient) — שם, רמת סיעוד, עיר
2. **פרטי מעסיק** (Employer) — שם, קרבה, עיר, זיהוי (מוסתר)
3. **פרטי מטפל** (Caregiver) — שם כבדרכון, כינוי, אזרחות, שפה (פרטי דרכון/בנק — P0 אך שלב נפרד)
4. **אנשי קשר ראשוניים** (CaseContactRoles) — לשכת סיעוד, תאגיד מורשה
5. **RACI ראשוני** — מי אחראי על מה
6. **סיכום + אישור** — review לפני שליחה

**`OpenCasePage.test.tsx` כבר קיים** — PR מרחיב את הטסטים.

### קבצים שמשתנים

| קובץ | פעולה |
|---|---|
| `apps/web/src/pages/OpenCasePage.tsx` | refactor לWizard מלא |
| `apps/web/src/components/Wizard.tsx` | Wizard wrapper (feature-local, לא ב-packages/ui) |
| `apps/web/src/components/Stepper.tsx` | progress indicator |
| `apps/web/src/pages/open-case/RecipientStep.tsx` | שלב 1 |
| `apps/web/src/pages/open-case/EmployerStep.tsx` | שלב 2 |
| `apps/web/src/pages/open-case/CaregiverStep.tsx` | שלב 3 |
| `apps/web/src/pages/open-case/ContactsStep.tsx` | שלב 4 |
| `apps/web/src/pages/open-case/RACIStep.tsx` | שלב 5 |
| `apps/web/src/pages/open-case/SummaryStep.tsx` | שלב 6 |
| `apps/web/src/hooks/useCaseWizard.ts` | Zustand store לstate השלבים (justified: cross-step draft) |
| `apps/web/src/pages/OpenCasePage.test.tsx` | הרחבה: back/next, preserved input, submit failure |
| `packages/i18n/src/resources/he.json` | מפתחות: `wizard.stepOf`, `wizard.back`, `wizard.next`, `wizard.summary`, `wizard.confirm`, `wizard.exitWarning` |
| `packages/schemas/src/employment-case.ts` | הרחבת request schema אם נדרש |

### פרטי מימוש קריטיים
- **Back/Next שומרים input** — `useCaseWizard` ב-Zustand (justified: cross-step form state)
- **Summary screen** — review לפני שליחה, הדגשת sensitive fields (caregiver name)
- **SensitiveFieldNotice** (Design System §9) לפני שדות passport/bank
- **exit warning**: Dialog אם המשתמש לוחץ Back בשלב > 1
- Stepper: לא מציין steps עתידיים כ-"clickable" אם לא הושלמו
- שלב 5 (RACI): אין RACIEditor מלא — selector פשוט של member + role
- CD-F1-01: Tenant + FamilyAccount + User + TenantMembership נוצרים ב-first-time flow (stub — API מטפל)
- CD-F1-02: draft case מותר להישמר עם שדות חסרים; הפעלה רק כשהכל שלם

### קריטריוני קבלה
- [ ] CD-F1-02: draft case status; activation reports missing prerequisites
- [ ] CD-F1-03: CaregiverStep: passport לא נאסף כאן — SensitiveFieldNotice מוצג, flow מופנה לשלב עתידי
- [ ] CD-F1-05: Contact ≠ User הודגש בבירור ב-ContactsStep
- [ ] CD-F1-06: RACI: 1 accountable + 1 responsible minimum
- [ ] CD-F7-02: form input נשמר בכישלון שמירה; error message ספציפי
- [ ] Wizard contract: persistent title + progress; Back/Next + saved input; summary before submit
- [ ] `OpenCasePage.test.tsx`: navigation back/next, error recovery, duplicate submission safe

### שערי pnpm check
```
pnpm format:check   ✓
pnpm lint           ✓
pnpm typecheck      ✓
pnpm test           ✓  (OpenCasePage.test.tsx, open-case/* step tests)
pnpm test:a11y      ✓
pnpm build          ✓
```

### רשימת בדיקת RTL + מובייל
- [ ] Stepper: RTL — step 1 מימין, step 6 משמאל
- [ ] Back/Next: כפתורי ניווט מוחלפים ב-RTL (Back = inline-end, Next = inline-start) — **אחד מהמקומות הנפוצים ביותר לבאג RTL**
- [ ] שדות passport/bank (LTR content): direction="ltr" על ה-input, label ב-RTL
- [ ] **טלפון אמיתי**: wizard עובר בין שלבים ב-swipe (enhancement) ובכפתורים
- [ ] **טלפון אמיתי**: keyboard לא מסתיר את כפתור Next ב-iOS
- [ ] exit dialog: focus trap, Escape סוגר

### תלויות
תלוי ב-**PR-0, PR-2, PR-5** (Wizard pattern + ContactsStep).

---

## מטריצת תלויות

```
PR-0 (tokens)
  └─► PR-1 (DB migrations) ────────────┐
  └─► PR-2 (AppShell)                  │
        └─► PR-3 (TaskRow) ────────────┤
              └─► PR-4 (Dashboard) ────┤
                    └─► PR-5 (Case)    │
                          └─► PR-7 (Documents)
                          └─► PR-8 (VisaRenewal) ◄── PR-1, PR-7
                    └─► PR-6 (Calendar)
  └─► PR-9 (OpenCase Wizard) ◄── PR-2, PR-5
```

---

## שערים גלובליים לכל PR

כל PR חייב לעבור את כל אלה לפני merge:

```text
pnpm format:check   ✓  (Prettier)
pnpm lint           ✓  (ESLint + jsx-a11y)
pnpm typecheck      ✓  (tsc strict: true בכל package)
pnpm test           ✓  (Vitest, כולל @caredesk/ui vitest.config.ts)
pnpm test:a11y      ✓  (axe-playwright smoke)
pnpm build          ✓  (Vite + tsc build)
```

ו-PR description חייב לכלול (לפי AI Review Constitution §7):
- outcome ו-reason
- authority documents שנקראו
- screenshots/interaction evidence לכל UI change
- data/privacy/security impact
- exact checks run
- הצהרת agent: "Not merged"

---

## הערות יישום חשובות

### RTL — השגיאות הנפוצות ביותר בפרויקט זה
1. **Stepper/Wizard back-next**: Back הוא `inline-end` ב-RTL, Next הוא `inline-start`
2. **Calendar arrows**: "הבא" = `›` אבל ב-RTL הוא בצד ימין
3. **Timeline**: chronological = ימין → שמאל
4. **Icon mirroring**: אייקוני "forward/back" מתהפכים; אייקוני status לא
5. **LTR input בתוך RTL form**: passport, email, IBAN — `dir="ltr"` על ה-input, label נשאר RTL

### בדיקת טלפון אמיתי
הcommit האחרון במאגר הגדיר `VITE_HOST=0.0.0.0` כדי שה-dev server יהיה נגיש מרשת מקומית. לכל PR בעל UI:
1. `pnpm dev` עם `--host`
2. סריקת QR code מהטלפון
3. בדיקה ב-iOS Safari + Android Chrome
4. תיעוד screenshots בתיאור ה-PR

### synthetic data בלבד
אין שום ערך אמיתי — לא שם, לא מספר דרכון, לא חשבון בנק — ב-fixtures, screenshots, או PR descriptions.

### MockAIProvider
כל PR שנוגע ב-AI (PR-4 dashboard suggestion, PR-8 draft message stub) משתמש אך ורק ב-`packages/infrastructure/src/mocks/mock-ai-provider.ts`. שום network call לספק חיצוני עד לאישורי ADR-003.
