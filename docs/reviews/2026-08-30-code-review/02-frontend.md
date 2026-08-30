# Frontend / Screens Review

## Summary

The frontend is two products stitched together: a local-first, localStorage-backed "MVP" world (`/clients/:clientId/*` — onboarding, payroll, documents, tasks, settings) and a canonical server-backed world (`/cases/:caseId` — contacts, tasks, documents, visa renewal, payroll entries). The seams between them are where the worst defects live: four screens pass the **local MVP client UUID where the API expects a canonical `caseId`**, and the Playwright fixtures mock `/cases/[^/]+/…` with a wildcard, so no test can detect it. The monthly payroll close — the single most money-critical action in the product — calls the wrong id space, has no `try`/`catch`, no busy state, no success or failure message, and reuses one idempotency key for the whole component lifetime; it silently does nothing and tells the user nothing. Separately, there is **no unsaved-changes guard anywhere in the app** (no `beforeunload`, no router blocker), and the payroll wizard holds a full month of entry in component state that is never drafted, so one tap on the mobile bottom nav destroys it. The canonical-payroll screen resets an in-progress draft to blank whenever any sibling mutation triggers a refetch, and `SettingsPage`'s `edited` latch plus whole-object writes let a stale pre-hydration draft overwrite server-hydrated fields. On the positive side, the workspace sync layer, its "never upload an unreadable/empty snapshot" guards, `packages/ui`, `AutocompleteField`, `AutomationPanel` and the react-hook-form case sections are genuinely careful work, and `i18n` has full 986-key parity.

## Findings

### [BLOCKER] Monthly payroll close silently does nothing — wrong id space, no error handling, one reused idempotency key

- **ID:** WEB-01
- **File:** apps/web/src/components/PayrollIntelligence.tsx:31, apps/web/src/components/PayrollIntelligence.tsx:69-92, apps/web/src/pages/PayrollPage.tsx:727-732
- **What:** `closeMonth()` posts to `/cases/${caseId}/payroll-month-closes` where `caseId` is actually the local MVP client UUID (`caseId={clientId}` from `/clients/:clientId/payroll`), has no `try`/`catch`, no in-flight state and no success/failure UI, and signs every request with a single `useRef(crypto.randomUUID())` key created once per mount.
- **Why it matters:** Three compounding failures on the same button. (1) `clientId` comes from `createMvpClient()`'s local `crypto.randomUUID()` while canonical case ids come from `POST /cases`; the server sees an unknown case → 403/404. (2) `onClick={() => void closeMonth()}` means the rejection is an unhandled promise: the employer taps "אישור שהחודש מוכן וסגירה", nothing changes, no error appears, and the close history stays empty forever — they cannot tell whether the month was recorded. (3) Even against a correct case id, closing a second month reuses the first month's idempotency key, so the server replays the first close and the second month is never recorded while the UI shows no complaint. `refreshCloses()` also has no `.catch`, so its failure is a second unhandled rejection and `closes` silently stays `[]`.
- **Fix:** Pass the authenticated `EmploymentCase` id (not the local client id) or remove the canonical call from this local screen; wrap `closeMonth` in `try/catch` with a `'saving' | 'saved' | 'error'` state rendered as `role="alert"`/`role="status"`; generate the idempotency key per close attempt (keyed by month, regenerated after a successful close); add `.catch` to `refreshCloses`.
- **Confidence:** CONFIRMED

### [BLOCKER] No unsaved-changes guard anywhere; the payroll wizard is never drafted, so one navigation tap destroys a month of entry

- **ID:** WEB-02
- **File:** apps/web/src/pages/PayrollPage.tsx:167-171, apps/web/src/pages/PayrollPage.tsx:434-441, apps/web/src/AppShell.tsx:255-277
- **What:** The five-step payroll wizard keeps every entered value in `useState` (`values`, `additionalPayments`) and only persists on the final "אישור ושמירה"; there is no `beforeunload` handler, no router `useBlocker`, and `loadMonth()` overwrites all values with no confirmation.
- **Why it matters:** Verified by grep — `beforeunload`/`useBlocker`/`usePrompt` appear nowhere in `apps/web/src`. Concrete flows: (a) the user fills steps 2–4 (base salary, work days, Saturdays, holiday/vacation/sick pay, advances, deductions — ~20 fields), then taps "משימות" in the fixed mobile bottom nav to check something; `PayrollPage` unmounts and every value is gone with no warning. (b) At step 1 the user changes the month input to correct a mistake; `onChange={(event) => loadMonth(event.target.value)}` (line 815) resets `values` and `additionalPayments` to the stored/blank record — silently discarding everything typed. (c) "עריכת החודש" in the annual history (line 1741) does the same to an in-progress month. For the 50–60-year-old target user on a phone, (a) is a routine mis-tap.
- **Fix:** Persist the wizard to a scoped draft key the way `OnboardingPage` already does (`saveMvpOnboardingDraft` pattern, debounced), restore it in the `useState` initialiser, and add a router blocker + `beforeunload` while the draft differs from the saved record. Require an explicit confirm before `loadMonth` discards unsaved values.
- **Confidence:** CONFIRMED

### [BLOCKER] SettingsPage can overwrite server-hydrated profile fields with stale pre-hydration values

- **ID:** WEB-03
- **File:** apps/web/src/pages/SettingsPage.tsx:32-46, apps/web/src/pages/SettingsPage.tsx:115-122
- **What:** `draft` is seeded once from `profile`; the `useEffect` that re-syncs it to a later-arriving profile is disabled permanently after the first keystroke (`if (!edited)`), and submit writes the **whole** draft object via `setProfile(draft)`.
- **Why it matters:** `AuthProvider` renders the app immediately when `canUseCachedWorkspace(user.id)` is true (auth-context.tsx:139-145), then continues `startWorkspaceSync` in the background; a successful hydration calls `replaceMvpWorkspace(response.snapshot)` (workspace-sync.ts:291-298), which wipes and rewrites every `caredesk.mvp.*` key and fires `MVP_PROFILE_CHANGED`. Scenario: the user opens Settings on a phone with a stale device cache (e.g. a spouse added the bureau contact and the medical-insurance expiry from another device), types one character into "מספר טלפון" before hydration lands, hydration then replaces the store with the fuller server profile, but `edited === true` so `draft` keeps the stale copy for all ~30 untouched fields. Pressing "שמירה" writes that stale draft back over the hydrated profile and the sync layer PUTs it to the server, destroying the other device's edits. The existing test `SettingsPage.test.tsx:179 'keeps values the user is editing when a later profile arrives'` only asserts the *edited* field survives; it never asserts the untouched hydrated fields do.
- **Fix:** Track edits per field, not per form — merge later-arriving profiles into the draft for fields the user has not touched. On submit, send only the changed fields (`{...profile, ...changedFields}` computed at submit time from the current `profile`, via `updateMvpProfile(changes)` which already exists) rather than the whole snapshot. `EmployeePage.tsx:71` has the same whole-object-write shape.
- **Confidence:** LIKELY

### [BLOCKER] Canonical payroll draft is wiped whenever a sibling mutation triggers a refetch

- **ID:** WEB-04
- **File:** apps/web/src/pages/case/CanonicalPayrollIntelligence.tsx:159-168, apps/web/src/pages/case/CanonicalPayrollIntelligence.tsx:264-316
- **What:** `useEffect(..., [entries, month])` calls `setDraft(found ? {...found} : blank())`, and `entries` gets a brand-new array identity from every `refresh()` — which `addExpense`, `removeExpense` and `migrateLegacyExpenses` all call.
- **Why it matters:** The month's payroll worksheet (16 numeric fields plus a repeatable additional-payments list) and the scenario-expense form live on the same screen, one above the other. The user fills in the payroll worksheet, scrolls down, adds a planning expense ("הוספת הוצאת תרחיש"), and `addExpense → refresh() → setEntries(payroll)` re-runs the effect with a new array reference. Because the month has no saved server entry yet, `found` is `undefined` and the effect calls `blank()`: every number the user just typed resets to `0` with no warning and no message. Removing an expense or running the legacy-expense migration does the same.
- **Fix:** Key the draft reset on the identity of the entry for the selected month, not on the `entries` array reference (e.g. depend on `entries?.find(e => e.month === month)?.id` and `?.version`), and never reset a dirty draft without an explicit user action.
- **Confidence:** CONFIRMED

### [HIGH] A transient or expired session unmounts the whole app tree and destroys in-progress form state

- **ID:** WEB-05
- **File:** apps/web/src/auth/auth-context.tsx:172-198, apps/web/src/auth/auth-context.tsx:316-325
- **What:** `AuthProvider` returns `loading` / `login` / `storageUnavailable` **instead of** `children`, so any auth state change tears the entire React subtree down; `recoverTransientSession()` sets `state = 'loading'` on every empty-session event.
- **Why it matters:** Supabase surfaces a momentary null session on token refresh and when a mobile browser resumes a suspended tab — this is exactly what `recoverTransientSession`'s comment says it exists for. When it fires, `setState('loading')` swaps the whole app for `<AuthLoadingPage/>`, unmounting `PayrollPage` / `SettingsPage` / `DocumentsPage` and discarding their component state. If the 1.5 s recovery fails, the user lands on the login page and every typed value in the wizard, the settings form and the document form is gone. Nothing in `apiRequest` (client.ts:101-130) handles a mid-flow 401 either — each screen treats it as a generic failure, and only `VisaRenewalSection` distinguishes 401/403.
- **Fix:** Keep `children` mounted and overlay the loading/login state (portal or absolutely-positioned cover) so component state survives a transient auth blip; combined with WEB-02's draft persistence this makes the loss non-fatal. Add a single 401 handler that shows a re-authentication prompt without unmounting the form.
- **Confidence:** CONFIRMED

### [HIGH] No error boundary anywhere, and every localStorage write is unguarded

- **ID:** WEB-06
- **File:** apps/web/src/main.tsx:16-24, apps/web/src/storage/mvp-storage.ts:135-137
- **What:** `grep -rn "ErrorBoundary\|componentDidCatch"` over `apps/web/src` and `packages/ui` returns nothing, and `writeBusinessItem` → `window.localStorage.setItem` is called with no `try`/`catch` from `saveMvpProfile`, `saveList`, `saveClients`, `saveMvpOnboardingDraft` and `replaceMvpWorkspace`.
- **Why it matters:** `localStorage.setItem` throws `QuotaExceededError` when the origin quota (~5 MB) is exhausted and throws outright in Safari private browsing. The store is a plausible quota risk: `MvpDocument` still carries a legacy `dataUrl?: string` (base64 file bodies), and every business key is AES-GCM-hex-encoded, roughly doubling its size. When the throw happens inside a React event handler — `TasksPage.saveTask` (line 104), `SettingsPage` submit (line 120), `MedicationsPage.persist`, `PayrollPage.savePayroll` (line 545) — it propagates uncaught and React 18 unmounts the entire tree: the user gets a blank white page at the exact moment they pressed "save", with their input gone and no explanation. Only `DocumentsPage.saveDocument` wraps its persist in `try`/`catch`; `DocumentsPage.removeDocument` does not.
- **Fix:** Add a top-level `ErrorBoundary` in `main.tsx` that renders a Hebrew recovery screen instead of a blank page, and make `writeBusinessItem` throw a typed `StorageWriteError` that every `persist()` catches and surfaces as an inline error instead of a success message.
- **Confidence:** CONFIRMED

### [HIGH] Fire-and-forget mutations: a failed save shows the user nothing at all

- **ID:** WEB-07
- **File:** apps/web/src/pages/case/ProductCompletionPanel.tsx:157, apps/web/src/pages/case/CollaborationPanel.tsx:82, apps/web/src/pages/WorkerPortalPage.tsx:118-124
- **What:** Several write paths call an API function with `void`/bare `async` and no `catch`, no busy state and no result UI.
- **Why it matters:** Enumerated instances, all silent on failure: `ProductCompletionPanel.tsx:157` `void confirmAssistantChecklist(caseId, answer.proposedChecklist!)` — the "create tasks" button; `:162`/`:286` `void escalate()` (creates a professional review); `:135` `void ask()` (try/finally, no catch); `:252` `void loadHistory()`. `CollaborationPanel.tsx:82,104` `void put(...)` for responsibility and task assignment, and `:154-161` the worker-request status `<select>` whose `onChange` awaits a PATCH with no catch — because the select is controlled by `data`, a failed PATCH makes the value snap back with no message, reading as "the app ignored my click". `WorkerPortalPage.tsx:118` (payment acknowledgement — a legally-loaded act), `:189` (new worker request) and `:245` (save preferences) are all unguarded `async` handlers; "save preferences" never confirms success or failure under any circumstance. Every one of these is also an unhandled promise rejection.
- **Fix:** Give each mutation the `'saving' | 'saved' | 'error'` treatment `AutomationPanel.tsx:29-42` already models correctly, and disable the control while in flight.
- **Confidence:** CONFIRMED

### [HIGH] Document save has no double-submit guard — one impatient double-tap creates two documents and two uploads

- **ID:** WEB-08
- **File:** apps/web/src/pages/DocumentsPage.tsx:79-121, apps/web/src/pages/DocumentsPage.tsx:251-253
- **What:** `saveDocument` is `async` (it awaits `saveDocumentFile`, which uploads the whole file), but the submit button has no `disabled` state and `resetForm()` only runs after the await resolves.
- **Why it matters:** For a new document `existing` is `undefined`, so each submit mints a fresh `crypto.randomUUID()`. On a slow mobile connection uploading a 10 MB passport scan, a second tap while the first request is in flight produces two ids, two `PUT /workspace/files/...` uploads, and two `MvpDocument` rows for the same file. The user then sees a duplicated document card and no way to know which is which. `removeDocument` (line 144) is likewise unguarded and, on API failure, produces an unhandled rejection with no message and no state change.
- **Fix:** Add an `isSaving` state, `disabled={isSaving}` on the submit button, and derive the document id once before the first submit. Wrap `removeDocument`'s await in `try`/`catch` with a surfaced error.
- **Confidence:** CONFIRMED

### [HIGH] A failed refetch is reported as a failed save, and none of these POSTs are idempotent — retrying creates duplicates

- **ID:** WEB-09
- **File:** apps/web/src/pages/case/CaseContactsSection.tsx:40-50, apps/web/src/pages/case/CaseTasksSection.tsx:64-73, apps/web/src/pages/case/CaseDocumentsSection.tsx:96-111, apps/web/src/pages/FamilyAccessPage.tsx:61-85
- **What:** Each handler does `await mutate(); setState(await list()); reset();` inside one `try`, so a failure of the *list* call after a *successful* mutation lands in the same `catch` and shows "adding failed"; and `addCaseContact` / `createCaseTask` / `uploadCaseDocument` / `inviteFamilyMember` send no `idempotency-key` header (compare `startVisaRenewal`, `createBinderExport`, `savePayrollEntry`, which all do).
- **Why it matters:** The contact/task/document was created, the form was never reset, and the user is told it failed — so they press submit again and get a duplicate contact, a duplicate task, or a second upload of the same passport scan. The same holds for a request that succeeds server-side but whose response is lost to a mobile network drop. In `FamilyAccessPage.submitInvitation` the fields are cleared *before* `await load()`, so a `load()` failure shows a generic error with the typed name and email already gone, and the retry hits `FAMILY_MEMBER_EXISTS`.
- **Fix:** Separate the mutation `try` from the refetch `try` — a refetch failure should show "saved, could not refresh the list", not "failed". Add a per-submission `idempotency-key` to all four POSTs, generated once per form submission attempt (not per request).
- **Confidence:** CONFIRMED

### [HIGH] Sign-out can fail silently, leaving the user signed in and their PII cache on a shared device

- **ID:** WEB-10
- **File:** apps/web/src/AppShell.tsx:181, apps/web/src/auth/auth-context.tsx:297-311
- **What:** `signOut()` returns `false` without side effects when `flushWorkspaceSync()` fails or when Supabase returns an error, and all four call sites invoke it as `onClick={() => void auth.signOut()}` with no handling of the return value.
- **Why it matters:** `flushWorkspaceSync` returns `false` whenever the pending snapshot could not be saved (offline, expired token, `unreadableKeys > 0`, version conflict) — a realistic state, since the sync banner already exists for it. The user taps "התנתקות", **nothing at all happens on screen**, and they walk away from a clinic or family computer believing they signed out. The session stays live, `caredesk.mvp.*` keeps every ID number, passport number, medication list and payroll record, and the sessionStorage decryption key is still present so the next person in that tab can read all of it. The other three call sites (AppShell.tsx:300, FamilyAccessPage.tsx:132, ClientsPage.tsx:98, AccountFrozenGate.tsx:72) have the same gap.
- **Fix:** Surface the failure — a modal offering "sign out anyway (unsaved changes on this device will be lost)" versus "retry saving" — and never leave the button appearing to have done nothing.
- **Confidence:** CONFIRMED

### [HIGH] The canonical case module is unreachable: no route creates a case, so the case, binder and visa screens are dead ends

- **ID:** WEB-11
- **File:** apps/web/src/App.tsx:352, apps/web/src/pages/OpenCasePage.tsx:21, apps/web/src/pages/EmergencyBinderPage.tsx:89-103
- **What:** `OpenCasePage` — the only component that calls `openEmploymentCase()` — is never referenced by any route (grep confirms: only its own file and its test), and `/cases/new` is explicitly `<Navigate to="/" replace />`.
- **Why it matters:** No user can create an `EmploymentCase`, so `/cases/:caseId` (and with it `CaseContactsSection`, `CaseTasksSection`, `CaseDocumentsSection`, `CaseTimelineSection`, `VisaRenewalSection`, `CollaborationPanel`, `ProductCompletionPanel`, `CanonicalPayrollIntelligence`) is reachable only by pasting a UUID. `EmergencyBinderPage`, which *is* in the mobile nav ("תיק חירום"), loads `listEmploymentCases()` and will show "לא נמצא תיק העסקה פעיל" to every real user — a headline feature that is permanently empty. Meanwhile the same business facts exist twice: contacts, tasks, documents and payroll all have a local MVP implementation and a canonical one, with no linkage or reconciliation except the manual migration widgets inside `CanonicalPayrollIntelligence`.
- **Fix:** Either route `OpenCasePage` and drive case creation from the end of onboarding (mapping the local client to the created case id and storing it), or remove the unreachable canonical screens from the shipped bundle and the nav so the product does not advertise features no user can reach.
- **Confidence:** CONFIRMED

### [HIGH] Visa renewal is implemented twice, inconsistently, and its only workflow screen demands raw UUIDs with no way to advance a workflow

- **ID:** WEB-12
- **File:** apps/web/src/pages/case/VisaRenewalSection.tsx:245-292, apps/web/src/storage/mvp-storage.ts:614-643
- **What:** The consumer-facing visa model is a single date field (`profile.visaRenewalDate`) that auto-generates a local task (`system-visa-renewal`); the canonical model is a server workflow with statuses `not_started|active|blocked|completed|cancelled`, RACI assignments, blockers and evidence. Nothing connects them, and the only canonical UI is a "start" form asking the user to type `templateVersionId`, `currentAuthorizationId`, `stepKey`, `responsibleId` and `accountableId` as raw UUIDs/keys.
- **Why it matters:** (a) A user who completes the local visa task in `TasksPage` has changed nothing in the canonical workflow, and vice versa — the two representations can disagree indefinitely about whether the visa renewal is done. (b) The start form is an internal/admin surface shipped on a customer screen; a 60-year-old employer cannot supply a template version UUID, so the workflow can never legitimately be started from the product. (c) There is no UI to transition a workflow at all — no complete, cancel, resolve-blocker or link-renewed-authorization action — so a workflow that reaches `blocked` is a permanent dead end the user can only look at. The screen renders `assignment.assigneeId` and `linkedRenewedAuthorizationId` as bare UUIDs to the user.
- **Fix:** Pick one visa-renewal source of truth. If canonical: derive `templateVersionId` and `currentAuthorizationId` server-side or from a picker, resolve assignees from the family-membership list by name, add the transition actions, and drive `profile.visaRenewalDate` / the local task from the workflow's `evaluation.dueDate`. If local: remove the canonical section from the customer surface.
- **Confidence:** CONFIRMED

### [HIGH] The collaboration screen is hardcoded English with raw snake_case labels in a Hebrew RTL product

- **ID:** WEB-13
- **File:** apps/web/src/pages/case/CollaborationPanel.tsx:70-74, apps/web/src/pages/case/CollaborationPanel.tsx:118-168
- **What:** "Family collaboration", "Responsibilities", "Task assignments", "Worker requests", "No open requests.", "Unassigned", "Status", "In review", "Accept", "Reject", "Resolve", "Loading collaboration…", "Collaboration could not be loaded." are English literals, and the responsibility labels are rendered as `kind.replaceAll('_', ' ')` → "case management", "documents compliance", "visa authorization".
- **Why it matters:** The document is `<html lang="he" dir="rtl">` and the target user is a Hebrew-speaking family member in their 50s–60s. This screen is unusable for them: English labels inside an RTL layout, raw enum keys as field names, and untranslated `request.request_type` / `request.status` values shown verbatim. The bilingual `role="alert"` error message is also English-only. This is the one screen in the app that assigns who is responsible for what in the family — precisely the content that must be readable.
- **Fix:** Move every string in this file to `packages/i18n` (`he.json` already has the `collaboration.*` namespace — `collaboration.fromCaregiver` etc. are used here, so the surrounding chrome was simply never extracted) and translate the responsibility, request-type and status enums.
- **Confidence:** CONFIRMED

### [MEDIUM] Infinite loading states and unhandled rejections on data load

- **ID:** WEB-14
- **File:** apps/web/src/pages/case/ProductCompletionPanel.tsx:41-46, apps/web/src/pages/DashboardPage.tsx:146, apps/web/src/pages/OpenIssuesPage.tsx:57-59
- **What:** `void Promise.all([getCaseHealth(caseId).then(setHealth), listProfessionalReviews(caseId).then(setReviews)])` has no `.catch`; `DashboardPage` and `OpenIssuesPage` both do `void getCaseHealth(clientId).then(setHealth)` with no `.catch` — and pass the **local client id**, so the request fails on every load.
- **Why it matters:** In `ProductCompletionPanel`, a failed health fetch leaves `health === undefined` forever and the panel renders `{t('shell.loading')}` permanently — an infinite spinner with no retry, plus an unhandled rejection. On `DashboardPage` and `OpenIssuesPage` (the "overview" screen), the same-shaped id mismatch as WEB-01 means the health call fails on every visit for every user; the sections degrade to their local fallback but every page load logs an unhandled rejection, and the health-derived guidance never appears. `TimelinePage.tsx:19-21` makes the identical id mistake but at least catches it and shows "לא ניתן לטעון את ציר הזמן הקנוני" — so users see a permanent error banner on a nav-linked screen.
- **Fix:** Add `.catch` with an error state and a retry to all three, and resolve the id-space question from WEB-01 once for every caller.
- **Confidence:** CONFIRMED

### [MEDIUM] Onboarding claims "saved" unconditionally, and a stale draft can overwrite newer profile edits

- **ID:** WEB-15
- **File:** apps/web/src/pages/OnboardingPage.tsx:290-292, apps/web/src/pages/OnboardingPage.tsx:85-90
- **What:** A static `<aside role="status">✓ {t('onboarding.saved')}</aside>` is always rendered regardless of whether the debounced `saveMvpOnboardingDraft` succeeded; and `draft` is initialised as `restoredDraft?.profile ?? profile`, preferring an abandoned draft over the committed profile.
- **Why it matters:** (a) The reassurance most likely to be trusted is the one that is never checked. If the draft write throws (quota, private browsing — see WEB-06) the user still reads "נשמר" while nothing was written; on reload their answers are gone. (b) A user who abandons onboarding at step 3, later edits base salary and renewal dates in Settings, then reopens "עריכה מחדש של ההקמה" gets the *older* draft snapshot restored into every field; completing the wizard writes that snapshot over the newer Settings values via `setProfile(completed)`.
- **Fix:** Drive the saved indicator from an actual write result (`'saving' | 'saved' | 'error'`). On restore, merge the draft over the current committed profile field-by-field rather than replacing it, or discard drafts older than the profile's last update.
- **Confidence:** CONFIRMED

### [MEDIUM] Action failures are reported as load failures and replace the form region

- **ID:** WEB-16
- **File:** apps/web/src/pages/BillingPage.tsx:40, apps/web/src/pages/BillingPage.tsx:76-141
- **What:** A single `error` boolean is set by `load()`, `submit()`, `reconnectCard()` and `cancelSubscription()`, and when true the page renders the load-error card **instead of** the plan and the payment form.
- **Why it matters:** The user fills in billing name and email, ticks the recurring-charge consent, presses "חיבור כרטיס", the checkout-session request fails, and the screen replaces the whole form with "לא ניתן לטעון את פרטי החיוב" plus a "retry" that re-fetches the subscription rather than retrying the checkout. The typed values survive in React state but are invisible until the user finds the retry, and the message describes a completely different problem than the one that occurred. `cancelSubscription` behaves the same way. `FamilyAccessPage` has the softer version of this: its notice element sits at the very bottom of the page (line 306), so on a phone a failed invite renders an alert the user never scrolls to, with no focus management.
- **Fix:** Separate `loadError` from `actionError`; render action errors inline next to the control that failed and move focus to them.
- **Confidence:** CONFIRMED

### [MEDIUM] Deleting a client leaves uploaded identity documents behind, and the "backup" export is unencrypted plaintext PII

- **ID:** WEB-17
- **File:** apps/web/src/storage/mvp-storage.ts:239-246, apps/web/src/storage/document-file-store.ts:95-103, apps/web/src/pages/ClientsPage.tsx:19-27
- **What:** `deleteMvpClient` removes only `localStorage` keys ending in `.client.<id>`; it never touches the `caredesk.mvp.files.v1` IndexedDB store (which is keyed by document id and **not scoped by client**) and never calls `deleteWorkspaceFile` for the client's server-side uploads. `clearLocalDocumentFileCache` resolves its promise on `request.onblocked` (line 101) as if the delete had succeeded. `exportMvpClient` writes every decrypted business key to a plain JSON download.
- **Why it matters:** A user who taps "מחיקת תיק ההעסקה ואת כל הנתונים המקומיים שלו" and confirms is told the local data is gone, but passport and ID scans stay in IndexedDB indefinitely (local mode) and in server storage (cloud mode). Separately, when a second tab holds the database open, `deleteDatabase` fires `onblocked` and the code reports success — so the account-switch path in `startWorkspaceSync` (line 351) and the sign-out path in `stopWorkspaceSync` (line 405, not even awaited) can leave the previous account's document blobs on disk while account B is signed in. Finally, the "גיבוי" button produces a file containing Israeli ID numbers, passport numbers, medications and payroll history in clear text with no warning about where the user is about to store it.
- **Fix:** Scope the IndexedDB store per client and delete its records in `deleteMvpClient`/`resetMvpClient`, plus issue `deleteWorkspaceFile` for each of the client's documents; treat `onblocked` as a failure and surface it rather than resolving; await `clearLocalDocumentFileCache()` in `stopWorkspaceSync`; add a one-line warning next to the backup button that the file is unencrypted.
- **Confidence:** CONFIRMED

### [MEDIUM] The device cache key lives in sessionStorage while the data lives in localStorage — in local-only mode that is permanent loss

- **ID:** WEB-18
- **File:** apps/web/src/storage/business-storage-crypto.ts:14-35, apps/web/src/auth/client.ts:9-14
- **What:** `sessionKey()` stores the AES-GCM key in `sessionStorage` (`caredesk.cache-key.v1`) while every business value is encrypted into `localStorage`, so the key dies with the browser session and the ciphertext does not.
- **Why it matters:** The team already documented this happening in production (auth-context.tsx:110-117: "27 local keys none of which decrypted"). With Supabase configured the server copy rescues it. But `getBrowserAuthClient()` returns `null` whenever `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are absent, and `resolveAuthGateState` then runs the app in `local-bypass` mode with no server at all — `ClientsPage` even advertises "המידע נשמר במכשיר זה בלבד". In that mode, closing the browser makes every stored profile, payroll record, task and medication permanently unreadable, and `readMvpProfile` swallows the failure (`catch { return emptyMvpProfile }`) so the user is shown an empty, freshly-set-up-looking account rather than an error. `readList`, `readClientsRaw` and `readMvpOnboardingDraft` do the same.
- **Fix:** Derive the cache key deterministically (e.g. from the authenticated user id via WebCrypto) or persist it alongside the data with an explicit device-trust decision; and when `unreadableKeys > 0` in a mode with no server copy, show an explicit "the data on this device cannot be read" screen instead of an empty workspace.
- **Confidence:** CONFIRMED

### [MEDIUM] Legacy plaintext values are read back forever and never re-encrypted

- **ID:** WEB-19
- **File:** apps/web/src/storage/business-storage-crypto.ts:45-46
- **What:** `decryptBusinessStorageValue` returns `stored` verbatim when it does not carry the `caredesk-encrypted-v1:` prefix.
- **Why it matters:** The comment calls this a one-time migration, but nothing performs the migration: a plaintext key is only re-encrypted if some screen happens to write that exact key again. A user who was on the app before encryption shipped keeps their profile (ID number, passport number, addresses, phone numbers) in clear text in `localStorage` indefinitely, and `captureMvpWorkspace` happily uploads it as if it had been protected. It also means an attacker with local file access can plant readable values that the app will accept as its own data.
- **Fix:** On first read after hydration, rewrite every non-prefixed `caredesk.mvp.*` key through `writeBusinessItem`, and then reject unprefixed values.
- **Confidence:** CONFIRMED

### [MEDIUM] API base URL falls back to `:4000` on the page's own host, and no security headers are set

- **ID:** WEB-20
- **File:** apps/web/src/api/client.ts:36-45, apps/web/vercel.json:1-11
- **What:** With `VITE_API_BASE_URL` unset, `resolveApiBaseUrl()` returns `${protocol}//${hostname}:4000`; `vercel.json` defines a `/api/:path*` rewrite the client never uses and sets no response headers.
- **Why it matters:** A production deploy that forgets the env var sends every authenticated request to `https://care-platform-web.vercel.app:4000`, which never answers. The user does not get an explanatory screen — they get `storage-error` or a permanent "השמירה בענן נכשלה" banner with a retry that can never succeed. Separately, an app that holds Israeli ID numbers and passport scans ships with no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` or `Permissions-Policy`, so it can be framed for clickjacking and full URLs leak in the `Referer` to the Google Fonts origin the page already loads.
- **Fix:** Fail loudly at startup when the API base URL is unresolvable in a non-local deployment (or route through the existing `/api` rewrite), and add a `headers` block to `vercel.json` with at least `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin` and HSTS.
- **Confidence:** CONFIRMED

### [MEDIUM] i18n is bypassed on almost every business screen, and the English locale is unreachable

- **ID:** WEB-21
- **File:** apps/web/src/pages/PayrollPage.tsx:1, packages/i18n/src/init.ts:16-24
- **What:** The repo bans hardcoded Hebrew literals (`eslint.config.js:59-66`), and 19 files disable that rule at the top — including `AppShell`, `PayrollPage`, `TasksPage`, `DocumentsPage`, `EmployeePage`, `TimelinePage`, `ClientsPage`, `EmergencyBinderPage`, `CanonicalPayrollIntelligence` and `PayrollIntelligence`, i.e. the primary business surfaces. Meanwhile `initI18n` hard-codes `lng: DEFAULT_LOCALE` with no switcher, and `isRtlLocale`/`directionFor` (locales.ts:37-43) are exported but never called — `dir="rtl"` is static in `index.html`.
- **Why it matters:** `he.json` and `en.json` have exact 986-key parity, so a full English translation exists and is dead code that no test or screen exercises. If it is ever switched on, the untranslated screens above will render Hebrew inside an English UI, and the physical-direction CSS (`global.css:1826` `.timeline:before { right: 126px }`, `:2551`, and the `text-align: right` table rules at `:2064`/`:2295`) will lay out backwards. Group also covers accessibility gaps concentrated on those same non-i18n screens: `PayrollPage`'s step indicators are `aria-hidden` divs with no programmatic current-step announcement, `FamilyAccessPage`'s result notice renders far below the form with no focus move, and `CollaborationPanel`'s `<select>`s carry English `aria-label`s built from enum keys.
- **Fix:** Treat the disable comments as a tracked debt list and extract those screens; either wire a language switcher through `directionFor()` and logical CSS properties (`inset-inline-start`, `text-align: start`) or drop `en.json` so the parity test stops implying a working English build.
- **Confidence:** CONFIRMED

### [LOW] A regulation-rule admin console is rendered inside consumer Settings

- **ID:** WEB-22
- **File:** apps/web/src/pages/SettingsPage.tsx:568
- **What:** `<RegulationRulesAdmin />` — a draft → in_review → approved → active → retired lifecycle editor for regulatory rule content — renders unconditionally at the bottom of every user's Settings page, with no role check on the client.
- **Why it matters:** The target user is a family employer, not a content reviewer. If the server permits the read they can see and attempt to transition regulation rules; if it denies it they get a permanent `role="alert"` load-error at the bottom of their Settings page (the e2e fixture explicitly stubs this endpoint with `[]` "so the page is free of load-error alerts" — meaning the real behaviour is a visible error). Either way the screen is in an impossible state for its audience.
- **Fix:** Gate on an explicit role from the API and render nothing (not an error) when the user is not a reviewer; move the console to its own route.
- **Confidence:** CONFIRMED

### [LOW] `canonicalVersion` optimistic-lock field is declared and documented but never written or read

- **ID:** WEB-23
- **File:** apps/web/src/storage/mvp-storage.ts:551-552
- **What:** `MvpPayrollRecord.canonicalVersion?: number` is commented "Server optimistic-lock version", but `grep -rn canonicalVersion apps/web/src` returns only this declaration; `PayrollPage.savePayroll` (line 525) does not carry `existing?.canonicalVersion` forward.
- **Why it matters:** Dead scaffolding that reads as implemented safety. If a future canonical cutover starts consuming it, records saved through today's `PayrollPage` will carry no version and will either be rejected or overwrite server state unconditionally.
- **Fix:** Remove the field, or populate it from `savePayrollEntry`'s response and preserve it on every local re-save.
- **Confidence:** CONFIRMED

## Save-path matrix

| Screen | Mutation | Validated? | Error surfaced to user? | Input recoverable on failure? | Verdict |
|---|---|---|---|---|---|
| OnboardingPage | debounced `saveMvpOnboardingDraft` (localStorage) | n/a (draft may be invalid) | No — static "נשמר" always shown | Yes (draft), unless the write threw | **Fails** — unconditional success claim (WEB-15) |
| OnboardingPage | `complete()` → `setProfile` (localStorage + sync) | Yes, per-step + `currentValid` gate | No — throw is uncaught → white screen | No | **Fails** (WEB-06); stale draft can overwrite newer data (WEB-15) |
| SettingsPage | submit → `setProfile(draft)` | Yes (`profileIsValid` disables submit) | No error path at all | State survives, but untouched fields are overwritten | **Fails** (WEB-03) |
| EmployeePage | submit → `setProfile(draft)` | `required` only | No | Draft survives in state | Weak — whole-object write |
| PayrollPage | wizard → `saveMvpPayroll` + `saveMvpEmploymentExpenses` | Yes, thorough per-step + full re-validation on save | Validation yes (`role="alert"`); storage failure no | **No** — no draft, no nav guard | **Fails** (WEB-02, WEB-06) |
| PayrollPage | `saveSalarySettings` | Yes (base salary > 0, effective date) | Yes (`message`) | Yes | OK |
| PayrollPage | `saveExpense` / `toggleExpense` / `removeExpense` | Partial (category + due date) | Validation yes; storage failure no | Draft survives | Weak (WEB-06) |
| PayrollIntelligence | `closeCanonicalPayrollMonth` | Guard only (`total > 0`, date set) | **No — nothing at all** | n/a | **Fails** (WEB-01) |
| CanonicalPayrollIntelligence | `savePayrollEntry` | No client validation beyond `Number()` | Yes (`role="alert"`, 409 handled) | Draft survives the save, but not a sibling refetch | **Fails** (WEB-04) |
| CanonicalPayrollIntelligence | `createScenarioExpense` / `deleteScenarioExpense` | Yes (label + amount) | Yes (`expenseError`) | Yes | OK, but wipes the payroll draft (WEB-04) |
| DocumentsPage | `saveDocumentFile` + `saveMvpDocuments` | Yes (size, MIME, file present) | Yes, but always blames device storage | Yes | **Fails** — double-submit (WEB-08) |
| DocumentsPage | `removeDocument` / `openDocument` | Confirm dialog | **No** — unhandled rejection | n/a | **Fails** (WEB-07) |
| TasksPage | `saveMvpTasks` (create/edit/toggle/delete) | `required` only | Success message only; storage failure uncaught | Draft survives | Weak (WEB-06) |
| MedicationsPage | `saveMvpMedications` | Name non-empty | Success only | Draft survives | Weak (WEB-06) |
| ReminderRecipientsSection | `saveMvpReminderRecipients` | Name non-empty; consent gate is correct | Success only | Draft survives | Weak (WEB-06) |
| CaseContactsSection | `addCaseContact` | Yes (zod resolver) | Yes (`Alert`), `isSubmitting` guard | Yes (values preserved by design) | Good, except refetch conflation + no idempotency (WEB-09) |
| CaseTasksSection | `createCaseTask` / `completeCaseTask` | Yes (zod) | Yes, per-action | Yes | Same caveat (WEB-09) |
| CaseDocumentsSection | `uploadCaseDocument` | Yes (zod + size + MIME) | Yes | Yes | Same caveat (WEB-09) |
| VisaRenewalSection | `startVisaRenewal` | Yes (zod, UUID shapes) | Yes, 4 distinct codes | Yes | Good error handling; unusable inputs (WEB-12) |
| CollaborationPanel | responsibility / task assignee PUT | None | **No** | n/a (select snaps back) | **Fails** (WEB-07) |
| CollaborationPanel | worker-request status PATCH | None | **No** | n/a | **Fails** (WEB-07) |
| ProductCompletionPanel | `confirmAssistantChecklist` | None | **No** | n/a | **Fails** (WEB-07) |
| ProductCompletionPanel | `createProfessionalReview` (escalate) | None | **No** | n/a | **Fails** (WEB-07) |
| ProductCompletionPanel | `transitionProfessionalReview` | Note ≥3 chars for `resolved` | Yes (`transitionError`) | Yes (notes kept in state) | OK |
| AutomationPanel | `confirmAssistantChecklist` | Date-order validation | Yes (saving/saved/error) | Yes | **Good — reference implementation** |
| FamilyAccessPage | invite / role change / revoke | HTML constraints only | Yes, 5 distinct codes | Fields cleared before refetch on invite | Mostly good (WEB-09, WEB-16) |
| BillingPage | `startBillingPaymentMethodSetup` / cancel | Consent + provider gates, `busy` guard | Yes, but as a *load* error replacing the form | State survives, form hidden | **Fails** (WEB-16) |
| EmergencyBinderPage | `createBinderExport` | Selection non-empty, in-flight guard | Yes — explicit "unrecorded print" labelling | n/a | **Good** |
| RegulationRulesAdmin | create / transition rule | Yes (`draftIsValid`) | Yes, per-action, `busy` guard | Yes | **Good** |
| WorkerPortalPage | acknowledge payment / new request / preferences | `required`/`maxLength` only | **No, on all three** | Message text survives; nothing else | **Fails** (WEB-07) |
| LoginPage | sign in / sign up / reset / magic link | Yes (`validateRegistration`) | Yes, per-action statuses | Yes | **Good** — `submittingRef` double-submit guard |
| workspace-sync | `saveWorkspace` (background) | Snapshot guards (`unreadableKeys`, empty-before-hydration) | Yes — shell banner + retry | Yes (`dirty` flag persisted to meta) | **Good** |

## What is done well

- **`workspace-sync.ts` is the strongest file in the frontend.** `wouldDestroyRemoteData` refuses to PUT an empty or partially-decryptable snapshot over a populated server workspace, `hydratedThisSession` correctly distinguishes "the customer has no data" from "we have not read the server yet", generation counters prevent a stale response from clobbering a newer session, the `VERSION_CONFLICT` retry only proceeds when the remote fingerprint is unchanged, and `pauseWorkspaceSync` vs `stopWorkspaceSync` correctly separates transient auth loss from explicit sign-out. The comments explain *why*, with production evidence.
- **Account isolation genuinely works for the localStorage layer.** `canUseCachedWorkspace` gates on an owner marker *and* decryptability, and `startWorkspaceSync` clears the cache, the IndexedDB store and the crypto key before any UI can render another account's data. I could not construct a path where account B reads account A's `caredesk.mvp.*` values.
- **`packages/ui`** is small, documented and accessibility-first: every component's doc block states its states, ARIA contract and RTL behaviour; `Alert` correctly splits `role="alert"` from `role="status"` by severity; `Skeleton` announces once through a visually-hidden live region; `TextField` requires a real label and links errors via `aria-describedby`.
- **`AutocompleteField`** is a correct WAI-ARIA combobox (arrow keys, `aria-activedescendant`, `onMouseDown` before blur) that allows free text rather than acting as a whitelist.
- **`AutomationPanel.confirmPlan`** is exactly the save shape the rest of the app should copy: explicit `saving`/`saved`/`error` states, disabled while in flight, distinct `role="status"`/`role="alert"` messages.
- **`EmergencyBinderPage.exportBinder`** records a server-side receipt before printing and, when the server is unreachable, uses `flushSync` to label the printed page as an unrecorded local copy — an honest failure mode rather than a silent one.
- **Onboarding's draft persistence** (synchronous restore inside `useState` initialisers, immediate write on radio taps, wizard-only choices stored separately from the committed profile) is thoughtful, and the reason the payroll wizard's total absence of the same is so conspicuous.
- **`ReminderRecipientsSection`'s per-recipient consent model** (`consentAt`/`consentBy` timestamps, `canReceiveReminders` as the single send gate, a status column that says *why* someone will not be contacted) is a correct treatment of third-party health data.
- **CSS discipline for the audience**: 44/48 px minimum touch targets appear consistently, there is a `--ui-scale` font-size control persisted across reloads, a skip link, and a dedicated responsive width-matrix release gate.

## Coverage note

Unit coverage is broad by file count (40+ `.test.tsx`) and genuinely strong on pure logic — `payroll-calculation`, `payroll-report`, `quarterly-national-insurance`, `israeli-id`, `onboarding-fields`, `reminders/schedule` and `workspace-sync` (which does test hydration failure, version conflict and the unreadable-cache guard). The gaps sit precisely on the failing save paths above.

- **No test covers a failed mutation for the screens that swallow errors.** `grep` for `mockRejected`/`Promise.reject` shows failure-path tests exist for auth, billing, binder, regulation rules, canonical payroll and the case sections — but not for `PayrollIntelligence.closeMonth`, `ProductCompletionPanel`, `CollaborationPanel`'s PUT/PATCH handlers, `WorkerPortalPage`'s three mutations, or `DocumentsPage.removeDocument`/`openDocument`. Every WEB-07 instance is untested.
- **The e2e fixtures structurally hide WEB-01/WEB-14.** `canonical-product-intelligence.ts` routes `/cases/[^/]+/timeline`, `/cases/[^/]+/health` and `/cases/[^/]+/payroll-month-closes` by wildcard regex, so passing the local MVP client id where a canonical case id is required returns 200 in every test. No test asserts that the id sent to a `/cases/…` endpoint is a case id.
- **The reused-idempotency-key bug is one assertion away.** `launch-readiness.spec.ts:361` asserts `closeMutationCount() === 1` after closing a single month; the fixture already tracks `closeMutations` and `responsesByKey`. Closing a *second* month in the same page session and asserting `closeMutationCount() === 2` would fail today.
- **No test exercises navigation away from a dirty form.** `atm-onboarding-mobile.spec.ts` covers draft autosave and step resume for onboarding, but nothing navigates away from a half-filled payroll wizard or Settings form and returns; WEB-02 and WEB-03 would both be caught by such a test.
- **No test covers a storage write failure.** Stubbing `localStorage.setItem` to throw would immediately expose WEB-06 (white screen) and WEB-15 (false "saved").
- **`SettingsPage.test.tsx:179` asserts the wrong half of the invariant** — that the edited field survives a late profile — without asserting that the *untouched* hydrated fields survive the subsequent save. Extending that one test is the cheapest way to pin WEB-03.
- **Only one e2e test injects an HTTP error** (`login-progress.spec.ts`, a 400 on sign-in). There is no offline/500 e2e for any save path, and no test asserts that a failed sign-out tells the user anything (WEB-10).
- `OpenCasePage` has a test file but no route — its coverage is entirely notional (WEB-11).
