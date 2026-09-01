# CareDesk — Product & UX Improvement Backlog
## מסמך חי לעבודה עם Claude
**גרסה:** 1.1  
**תאריך יצירה:** 31.08.2026  
**עדכון אחרון:** 01.09.2026 — R4: הרחבת מטריצת הרוחבים למסכי הכסף (R4-04) ולמסכים שנותרו  
**בעלות:** Product / Engineering  
**עדכון:** Claude רשאי ומצופה לעדכן מסמך זה כחלק מכל Release.

> מטרת המסמך היא לנהל שיפורי מוצר ו-UX מעל תוכנית ה-Remediation הקיימת, מבלי ליצור כפילויות ומבלי להמציא מחדש יכולות שכבר קיימות.

---

## 1. הוראות עדכון לקלוד

לפני תחילת עבודה:
1. קרא את כל `docs/governance/` העדכני.
2. אמת את המצב בקוד ובבדיקות.
3. עבור כל פריט קבע Status אמיתי.
4. פריט שכבר תוכנן במקום אחר יקבל `ALREADY_PLANNED` + Reference.
5. פריט שכבר יושם יקבל `COMPLETE` רק עם Evidence.
6. כל שינוי סטטוס יכלול תאריך ו-Notes.
7. כל Release יתווסף ל-Release Log בתחתית המסמך.
8. אין למחוק פריטים היסטוריים; יש לעדכן סטטוס.

---

## 2. Status Model

`NEW` | `ALREADY_PLANNED` | `PARTIAL` | `BLOCKED` | `READY_FOR_WORK` | `IN_PROGRESS` | `IN_REVIEW` | `READY_FOR_PRODUCTION` | `DEPLOYED` | `PRODUCTION_VERIFIED` | `COMPLETE` | `REJECTED` | `LATER`

---

## 3. עקרונות Product

- לא לבנות מחדש את CareDesk.
- לא ליצור Source of Truth נוסף.
- להעדיף פישוט על פני הוספת Feature.
- AI מציע; המשתמש מאשר.
- Forecast אינו Actual.
- Score אינו Legal Compliance.
- תרופה ללא אישור נטילה אינה בהכרח "לא נלקחה".
- אין להציג חישוב כאמת משפטית.
- Mobile-first במסלולים נפוצים.
- כל פעולה משמעותית צריכה להסביר: מה, למה, מתי, מי, ומה הצעד הבא.

---

## 4. Release Plan

### Release 0 — Baseline & Production Safety
**מטרה:** לוודא בסיס בטוח לפני UX.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R0-01 | Environment Separation | PARTIAL | P0 | שורש 1 · `docs/governance/ENVIRONMENT-SEPARATION.md` · CI job `rls-test` (`.github/workflows` → `pnpm --filter @caredesk/db rls-test:ci`) | 01.09.2026 — המגן נחת: `db:rls-test` מסרב לרוץ מול ה-ref של הייצור. **פרויקט `caredesk-staging` עדיין לא נוצר** — המסמך עצמו עדיין מונה את יצירתו כשלב פתוח (§167). לא ניתן לאמת מכאן משתני סביבה ב-Vercel. |
| R0-02 | Migration Reliability | PARTIAL | P0 | שורש 2 · `scripts/check-migration-ledger.mjs` · CI job `guardrails` → "Apply every migration twice and require the second run to be empty" (`migrate-idempotency:ci`) · `apps/api/src/container.ts:750-765` (השוואת `public.schema_migrations` מול `REQUIRED_MIGRATIONS`) · מיגרציה `0044_app_role_reads_migration_ledger.sql` | 01.09.2026 — הרישום, הנעילה, ה-dry-run וההשוואה מול ה-ledger קיימים בקוד. **לא הורצו מכאן**: vitest אינו יכול לרוץ בסביבה הזו (`@rollup/rollup-linux-x64-gnu` חסר). ריצה ירוקה לא נצפתה. |
| R0-03 | Restore Drill | BLOCKED | P0 | `docs/governance/RESTORE-DRILL.md:4` — "נוהל השחזור מעולם לא הורץ" · צד הקוד נחת ב-`0116b43` (PR #108) | 01.09.2026 — **התרגיל מעולם לא בוצע.** ה-API לשחזור דייר בודד ולזיהוי אובדן שקט קיים; RTO של 4 שעות הוא עדיין ניחוש ולא מדידה. סעיף "רישום התוצאה" (שורות 287-306) ריק. חוסם את שער R0→R1. |
| R0-04 | Canonical Source of Truth | PARTIAL | P0 | שורש 3 · ADR-006 · מיגרציה `0042_employment_case_legacy_client_link.sql` · `a335357` (PR #110, "make the employment case reachable") | 01.09.2026 — התיק הקנוני הפך נגיש והקישור legacy→canonical נשמר על השורה הקנונית. **שני המודלים עדיין חיים**: `apps/web/src/storage/mvp-storage.ts` (32KB) הוא עדיין נתיב כתיבה פעיל דרך `apps/web/src/hooks/use-mvp-profile.ts:23` (`saveMvpProfile`). ה-blob לא הורד לתפקיד מטמון בלבד. |
| R0-05 | **שער R0→R1 פתוח — ועבודת R1/R5 כבר נחתה** | BLOCKED | P0 | R0-03 (תרגיל שחזור לא בוצע) · R0-01 (אין `caredesk-staging`) · R0-04 (dual storage חלקי) · מנגד: `c8b4175`, `e10c699` נחתו ב-31.08 | 01.09.2026 — **רישום כן.** סעיף 6 של מסמך זה אוסר מעבר ל-R1 כל עוד restore אינו מוכח, הפרדת סביבות אינה מאומתת ו-dual truth קיים. שלושת התנאים פתוחים. בפועל נחתה עבודת R1 (auto-save, error boundary) ו-R5/שורש 8 (טיפוס כסף) לפני סגירת השער. אין כאן טענה שהשער נסגר — יש כאן תיעוד שהוא נעקף. החלטה נדרשת: או לסגור את R0-01/03/04 לפני המשך R1+, או להחליט במפורש להמשיך תוך נשיאת הסיכון ולתעד זאת. |
| R0-06 | סטייה מנוהל: PR #112 היה Big Bang | NEW | P1 | `c8b4175` — 54 קבצים, 4,828 הוספות, שני שורשים (8 + 9) בענף אחד · `PRODUCTION-RELEASE-PROCEDURE.md` §1 ("אין לבצע Big Bang Release") ו-§3 ("Release אחד = מספר PRs קטנים לפי bounded concern") | 01.09.2026 — **סטייה מתועדת, לא מוסתרת.** PR #112 איחד את מודל הכסף (שורש 8) ואת מודל הכשל בממשק (שורש 9) ב-PR אחד. הסיבה שנרשמה: השניים נגעו באותם מסכי שכר, ופיצול היה דורש מיזוג פעמיים באותם קבצים. זו סיבה, לא היתר. גם #110 (57 קבצים) ו-#108 (113 קבצים) חורגים. פעולה: ב-Release הבא לפצל לפי bounded concern, או להוסיף ל-`PRODUCTION-RELEASE-PROCEDURE.md` חריג מפורש עם תנאים. |
| R0-07 | `/ready` מנמק את כשל המסד בשמו | READY_FOR_PRODUCTION | P0 | `apps/api/src/container.ts:765-788` — ה-catch מדווח `code: message` (28P01 סיסמה, 42501 הרשאה, ECONNREFUSED/ETIMEDOUT רשת) · `e10c699` (PR #111) · קריאת ה-ledger עברה להיות schema-qualified ב-`c8b4175` | 01.09.2026 — **מה שקרה ב-31.08:** הייצור היה למטה רוב היום מאחורי `/ready` שהחזיר את אותן ארבע מילים ("Database is unreachable") לחמש סיבות שונות; הסיבה בפועל הייתה ה-pooler שדוחה תפקיד בפורט אחד ומקבל אותו באחר, ואותרה רק בעזרת probe ידני. **מה שהשתנה:** קוד השגיאה והודעתה נכללים בתשובה; הקריאה ל-`schema_migrations` הוסבה ל-`public.` אחרי ש-`/ready` דיווח "44 מתוך 44 מיגרציות אינן רשומות" מול ה-`schema_migrations` של `auth`/`realtime` של Supabase; המיגרציה החסרה הראשונה מדווחת בשמה ולא כמספר. אינו `COMPLETE` — §11 של נוהל השחרור דורש אימות בייצור, שלא בוצע. |
| R0-08 | `/ready` בודק ש-SUPABASE_URL **מוגדר**, לא שהוא **נכון** | NEW | P0 | `apps/api/src/container.ts:322` — `hasSupabaseAuth = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY)` · `container.ts:683` — `authentication: hasSupabaseAuth ? 'ok' : 'unconfigured'` | 01.09.2026 — **הפער שנותר מהתקלה של 31.08.** בעוד `database` מקבל probe אמיתי מול המסד, `authentication` ו-`privateStorage` נבדקים בבוליאן על נוכחות משתנה סביבה בלבד. משמעות: URL שגוי, פרויקט Supabase שהוחלף, מפתח שפג — כולם ידווחו `ok`. במהלך ההשבתה של 31.08 `authentication` דיווח `ok` לכל אורכה. הפריט הזה הוא מה שנדרש כדי ש-R0-07 יהפוך לשלם: probe חי (למשל בקשת JWKS/`/auth/v1/health`) ו-probe של הדלי הפרטי, עם timeout ובלי לחשוף סוד. |

**Gate:** אין מעבר ל-R1 אם קיימת סכנת dual truth, migration לא אמינה או restore לא מוכח.
**מצב השער נכון ל-01.09.2026: פתוח.** ראה R0-05.

---

### Release 1 — Trust & Reliability UX
**מטרה:** המשתמש יודע אם הפעולה נשמרה.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R1-01 | Unified Saving / Saved / Error | PARTIAL | P0 | **שורש 5** · `apps/web/src/pages/PayrollPage.tsx:474` · `apps/web/src/pages/case/AutomationPanel.tsx:152` · `apps/web/src/pages/case/CanonicalPayrollIntelligence.tsx` · `apps/web/src/storage/workspace-sync.ts` | 01.09.2026 — מצב `saving/saved/error` קיים ב-**ארבעה** מסכים בלבד, כל אחד עם `useState` משלו. שורש 5 דורש "חוזה כתיבה אחד לכל האפליקציה, מיושם פעם אחת ומוחל בכל מקום" — הקומפוננטה/hook המשותפים אינם קיימים (`apps/web/src/hooks/` מכיל שלושה hooks, אף אחד מהם אינו hook כתיבה). |
| R1-02 | Double-submit protection | PARTIAL | P0 | **שורש 5** · `apps/web/src/pages/BillingPage.tsx:41,272,320,405` · `apps/web/src/pages/case/ProductCompletionPanel.tsx:40,135,241` · `apps/web/src/components/RegulationRulesAdmin.tsx:54,245` | 01.09.2026 — דגלי `busy` לכל מסך בנפרד, כולל בזרימת החיוב. אין מנגנון חוצה-אפליקציה, ולא אומת שהעלאת מסמך מוגנת (WEB-08 "הקשה כפולה יוצרת שני מסמכים" — לא הצלחתי לאתר הגנה במסלול ההעלאה). |
| R1-03 | Idempotency לפעולות רגישות | PARTIAL | P0 | **שורש 5** · `apps/web/src/api/client.ts` — כותרת `idempotency-key` ב-~14 מוטציות · `packages/db` `PgIdempotencyRepository` · מיגרציה `0040_idempotency_record_lockable.sql` | 01.09.2026 — 0040 תיקן את הכשל שבו כל מוטציה אידמפוטנטית ניסתה `SELECT … FOR UPDATE` על טבלה שתפקיד האפליקציה לא רשאי לנעול. **הכיסוי אינו מלא**: חלק מהקריאות ב-`client.ts` מייצרות `crypto.randomUUID()` בכל קריאה (שורות 214, 473, 484, 500, 693, 706) — מפתח חדש בכל ניסיון אינו מגן מפני שליחה כפולה, רק מפני retry של אותה בקשה. Monthly close לא אומת. |
| R1-04 | Auto-save באשפים ארוכים | READY_FOR_PRODUCTION | P0 | **שורש 9** (WEB-02) · `apps/web/src/storage/form-draft-store.ts` (namespace נפרד `caredesk.draft.*`, מוצפן, TTL 30 יום, `DraftStorageError`) · `apps/web/src/pages/PayrollPage.tsx:450-560` (שחזור טיוטה, `draftStatus`, ניקוי בעת commit) · בדיקות: `form-draft-store.test.ts`, `PayrollPage.draft.test.tsx` · `c8b4175` | 01.09.2026 — אשף השכר נשמר אוטומטית ומשחזר, כולל הודעה למשתמש וכשל אחסון מטופל. **אינו `COMPLETE`**: §11 של נוהל השחרור דורש אימות בייצור, שלא בוצע; והבדיקות **לא הורצו מכאן** (vitest אינו יכול לרוץ בסביבה). מכוסה רק אשף השכר — ראה R1-06. |
| R1-05 | Failure / retry model | PARTIAL | P0 | **= שורש 5 (כתיבה שקטה) + שורש 9 (אין error boundary)** · `apps/web/src/components/ErrorBoundary.tsx` · `apps/web/src/main.tsx:23` (`AppErrorBoundary`) · `apps/web/src/AppShell.tsx:268` (`SectionErrorBoundary resetKey={location.pathname}`) · `apps/web/src/components/ErrorBoundary.test.tsx` · `c8b4175` | 01.09.2026 — **זהו הפריט שהוא בפועל שורש 5 של תוכנית ה-Remediation, ואסור לנהל אותו כרשימה נפרדת.** ה-boundary נחת בשתי רמות (אפליקציה + מקטע, עם איפוס בניווט) — זה חצי שורש 9. חצי שורש 5 — "אין silent failure" ו-**retry** — לא נחת: לא אותר נתיב retry בשום מקום ב-`apps/web/src`. |
| R1-06 | Preservation of user input | PARTIAL | P1 | **שורש 9** · `apps/web/src/storage/form-draft-store.ts` · `DraftStorageError` (WEB-06 — כתיבת localStorage לא מוגנת הפילה את העץ) | 01.09.2026 — עלה מ-`NEW`: התשתית קיימת וגנרית (`saveFormDraft<T>`). מחוברת **רק** ל-`PayrollPage`. טפסים ארוכים אחרים (onboarding, ויזה, מסמכים) לא אומתו כמחוברים. |

---

### Release 2 — Action Experience
**מטרה:** Home עונה על "מה צריך לעשות עכשיו?".

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R2-01 | Unified Action Model | NEW | P1 | — | 01.09.2026 — אומת בקוד: אין מודל action משותף. `apps/web/src/product-intelligence.ts` בונה facts לכל משטח בנפרד, ו-`DashboardPage.tsx`, `OpenIssuesPage.tsx` ו-`components/OpenIssuesGlance.tsx` צורכים אותם עצמאית. תלוי ב-R0-04: מודל action אחיד מעל שני מודלי אחסון ייצור את הכפילות שהוא בא למנוע. |
| R2-02 | Home — דורש טיפול | PARTIAL | P1 | `apps/web/src/pages/DashboardPage.tsx:318-353` (`section.intelligence-attention`) · `apps/web/src/pages/OpenIssuesPage.tsx` · `apps/web/src/product-intelligence.ts` · `packages/i18n/src/resources/he.json:465` "דורש טיפול" · `DashboardPage.test.tsx:214-221` | 01.09.2026 — קיים בפועל, נגזר מ-facts קנוניים ולא מ-store חדש, ומציג `liability.reminder`. חסר: סדר עדיפות מוכח (אין assertion על סדר), ולא נבדק ברוחבי מובייל (מטריצת הרוחבים כן מכסה את הדשבורד — ראה R4-01). |
| R2-03 | Home — בקרוב | PARTIAL | P1 | `apps/web/src/components/UpcomingPaymentsCard.tsx` + `UpcomingPaymentsCard.test.tsx` · `packages/i18n/src/resources/he.json:585-586` ("תשלומים קרובים") · מפתחות `soon` בשורות 528/534/542 | 01.09.2026 — "בקרוב" קיים לתשלומים ולנושאים פתוחים. לא אוחד למקטע אחד ב-Home ואינו נגזר מ-Timeline. |
| R2-04 | Home — מאז הפעם האחרונה | NEW | P1 | — (אומת: אין) | 01.09.2026 — אומת בקוד: אין קומפוננטה ואין מפתח i18n ל-"מאז הביקור האחרון" ב-`he.json`. דורש מצב "נראה לאחרונה" לכל משתמש, שאינו קיים. זהה ל-R3-04 — לממש פעם אחת. |
| R2-05 | Home — הכול מסודר | PARTIAL | P1 | `apps/web/src/pages/DashboardPage.tsx:351` (`success-box`) · `he.json:466` `intelligence.empty`, `:484-485` `dashboard.okTitle`/`okBody`, `:481` `statusOk` | 01.09.2026 — עלה מ-`NEW`: מצב ריק חיובי קיים ומנוסח אנושית ("נעדכן כאן ברגע שמשהו ידרוש טיפול"). לא אומת שהוא מוצג עקבית בכל משטחי ה-Home. |
| R2-06 | CareDesk Score — framing אנושי | PARTIAL | P1 | `apps/web/src/pages/DashboardPage.tsx:354-384` · `he.json:472` `healthDisclaimer` — "מדד שלמות המבוסס על המידע בתיק; **אינו אישור לעמידה בדין**" · `DashboardPage.tsx:369` `liability.score` | 01.09.2026 — עלה מ-`NEW`: ההפרדה בין Score ל-Legal Compliance קיימת בטקסט ובכתב-ויתור, כנדרש בשער R2→R3. **הסדר עדיין Score → הסבר**, לא `Text → Explanation → Score` כפי שהפריט מגדיר. |
| R2-07 | CTA אחד ברור לכל Action | PARTIAL | P1 | `he.json:467` `intelligence.handle` = "לטיפול עכשיו" · `DashboardPage.tsx` (מקטע `attention`) · `he.json:493` `dashboard.nextAction` | 01.09.2026 — עלה מ-`NEW`: קיים CTA יחיד ומנוסח בפריטי "דורש טיפול". לא אומת שהכלל נשמר בכל action ובכל מסך. |

---

### Release 3 — Family Operating System
**מטרה:** ברור מי מטפל במה.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R3-01 | Owner visible on action | NEW | P1 | — | 01.09.2026 — לא אומת. פריטי "דורש טיפול" ב-`DashboardPage.tsx:318-353` מציגים provenance (מקור) אך לא אחראי. ADR-004 ו-`family-access` מספקים את הנתון; התצוגה אינה קיימת. |
| R3-02 | Assign / reassign לפי הרשאות | PARTIAL | P1 | `apps/web/src/pages/case/CollaborationPanel.tsx` + `CollaborationPanel.test.tsx` · `apps/api/src/routes` — `registerFamilyAccessRoutes` (`create-server.ts:175`) · ADR-004 | 01.09.2026 — הקצאה קיימת בפאנל שיתוף הפעולה. אכיפת הרשאות בשרת קיימת (`PgMembershipAuthorizationService`, `container.ts:334`); לא אומת שכל מסלול הקצאה עובר דרכה. |
| R3-03 | "טרם הוגדר אחראי" | NEW | P1 | — | 01.09.2026 — תלוי ב-R3-01. |
| R3-04 | Since last visit activity | NEW | P1 | — (אומת: אין) | 01.09.2026 — זהה ל-R2-04. אין מצב "נראה לאחרונה" ואין מפתח i18n. |
| R3-05 | Family wording simplification | NEW | P2 | — | 01.09.2026 — לא נבדק בסבב הזה. |
| R3-06 | Two-user browser journey | PARTIAL | P1 | `apps/web/e2e/family-collaboration.spec.ts` · `apps/web/e2e/worker-portal-mobile.spec.ts` · CI job `e2e` (Playwright, `pnpm --filter @caredesk/web test:e2e`) | 01.09.2026 — המסע קיים ורץ ב-CI. **ריצה ירוקה לא נצפתה מהסביבה הזו** ולא ידוע אם הוא מכסה שני משתמשים בו-זמנית או שני משתמשים ברצף. עדיין Gate ל-Production. |

---

### Release 4 — Mobile & Navigation
**מטרה:** להרגיש Mobile-first.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R4-01 | Home mobile | PARTIAL | P1 | `apps/web/e2e/responsive-width-matrix.spec.ts:142-149` — "דשבורד תיק העסקה" נמדד בכל שבעת הרוחבים · `c9d33d6` (מטרות מגע 48px, טאבים בדשבורד מפסיקים להתכווץ) · `ded53cc` (ניווט מובייל שוחזר) | 01.09.2026 — הדשבורד **כן** נמצא במטריצה. ריצה ירוקה לא נצפתה מהסביבה הזו. |
| R4-02 | Actions mobile | PARTIAL | P1 | `responsive-width-matrix.spec.ts:153` — "מסך משימות" נמדד בכל שבעת הרוחבים | 01.09.2026 — עלה מ-`NEW`: מסך המשימות מכוסה במטריצה. תלוי ב-R2-01 לגבי מסך actions מאוחד. |
| R4-03 | Document upload mobile | IN_REVIEW | P1 | `apps/web/e2e/responsive-width-matrix.spec.ts` — "מסמכים — רשימה" ו-**"מסמכים — טופס הוספה והעלאה"** בכל שבעת הרוחבים | 01.09.2026 — נוסף למטריצה. הטופס נמדד ולא רק הרשימה: הוא מאחורי כפתור "↑ הוספת מסמך", ולכן audit ברמת ה-route לעולם לא היה מגיע למסך שהפריט עוסק בו. **לא הורץ מכאן** — Playwright אינו יכול לרוץ בסביבה הזו. |
| R4-04 | Payroll mobile | IN_REVIEW | P1 | `apps/web/e2e/responsive-width-matrix.spec.ts` — טסט ייעודי לכל אחד משבעת הרוחבים: חמשת שלבי האשף, תצוגה מקדימה להדפסה, ושמירה שמייצרת את הדוח השנתי · `apps/web/e2e/fixtures/layout-matrix.ts` — כללים 6-8 חדשים + כלל 1 מתוקן + רצפת 48px למובייל · **תיקון CSS:** `apps/web/src/global.css` `@media (max-width: 760px)` → `.top-actions .font-size-controls button` מ-42×42 ל-48×48 | 01.09.2026 — **הפער היה המסכים, לא הרוחבים.** נוסף כיסוי מלא לאשף השכר (כל שלב, לא רק הראשון), לטבלת הביטוח הלאומי ולדוח השנתי — שלושת המסכים שבהם PR #114 הוסיף תג `ValueOrigin` ליד כל סכום. **דפקט אמיתי שנמצא ותוקן:** כפתורי הגדלת/הקטנת הטקסט ב-topbar היו 42×42 מתחת ל-761px — מתחת גם ל-44px שהמטריצה אוכפת מאז ומתמיד וגם ל-48px שאותו קובץ CSS מבטיח 40 שורות מאוחר יותר; הכלל הגנרי לא יכול היה לנצח בגלל specificity, ולכן ההקטנה שרדה את מעבר מטרות המגע. **לא הורץ מכאן** — Playwright אינו יכול לרוץ בסביבה הזו (אין דפדפנים מותקנים). |
| R4-05 | Visa mobile | PARTIAL | P1 | `responsive-width-matrix.spec.ts` — "נושאים פתוחים — כולל תוקף אשרת העבודה" (`/clients/:id/overview`) ו-"הגדרות התיק" בכל שבעת הרוחבים · `apps/web/e2e/visa-renewal.spec.ts` נשאר מסע פונקציונלי | 01.09.2026 — **מכוסה חלקית במכוון.** משטח הוויזה שנגיש בלי ה-API הקנוני (תוקף האשרה כפי שהוא מוצג ב-"נושאים פתוחים") נמדד בכל שבעת הרוחבים. **תהליך החידוש המנוהל ב-`/cases/:caseId` לא נכנס למטריצה**: הוא דורש חמישה mocks של `127.0.0.1:4000`, ומשיכתם לתוך שער פריסה הופכת כשל רשת לכשל פריסה. נדרשת החלטה אם להרחיב את `installCanonicalProductIntelligence` לכיסוי `/cases/:caseId`. |
| R4-06 | Family mobile | IN_REVIEW | P1 | `responsive-width-matrix.spec.ts` — "בני משפחה והרשאות" (`/family`) בכל שבעת הרוחבים, מעל ה-fixture הקיים `installFamilyAccessApi` | 01.09.2026 — נוסף למטריצה בלי fixture חדש. **לא הורץ מכאן.** |
| R4-07 | Medication reminders mobile | IN_REVIEW | P2 | `responsive-width-matrix.spec.ts` — "תרופות קבועות" בכל שבעת הרוחבים | 01.09.2026 — נוסף למטריצה. **לא הורץ מכאן.** |
| R4-08 | Settings mobile | IN_REVIEW | P2 | `responsive-width-matrix.spec.ts` — "הגדרות התיק" בכל שבעת הרוחבים | 01.09.2026 — נוסף למטריצה. **לא הורץ מכאן.** |
| R4-09 | Width matrix regression | IN_REVIEW | P1 | `apps/web/e2e/responsive-width-matrix.spec.ts` · `apps/web/e2e/fixtures/layout-matrix.ts` — `MATRIX_WIDTHS = [360, 390, 430, 768, 1024, 1440, 2560]`, `MIN_TOUCH_TARGET_PX = 44`, `MOBILE_TOUCH_TARGET_PX = 48` · CI job `e2e` · `RELEASE-GATE.md` §2 | 01.09.2026 — **זהו הפריט שהמסמכים מכנים "עבודת מטריצת הרוחבים"; אין לנהל אותו פעמיים.** עלה מ-`PARTIAL`: הכיסוי גדל משישה מסכים ל-19, וחמשת הכללים גדלו לשמונה. **שלושה תיקוני כלל מהותיים:** (1) כלל הגלישה האופקית נשען היה על `documentScrollWidth > innerWidth`, ומתחת ל-761px `global.css` מגדיר `overflow-x: clip` על html/body/#root — כלומר בשלושת הרוחבים שהפריט עוסק בהם הכלל **לא היה מסוגל להיכשל**; רכיב שחורג מקצה ה-viewport הוא עכשיו כשל בפני עצמו. (2) רצפת מטרת המגע במובייל הועלתה ל-48px, בדיוק לפקדים ש-`global.css` עצמו מבטיח להם 48 מתחת ל-761px. (3) נוספו שלושה כללים חדשים: טקסט נחתך, טקסט מוסתר מאחורי רכיב, ופקד טופס שהתווית שלו אינה נגישה. נוסף `test` שני שמוכיח שכל אחד מהם מסוגל להיכשל. RTL: הגלישה נמדדת בשני הקצוות. **ריצה ירוקה לא נצפתה מהסביבה הזו — Playwright אינו יכול לרוץ כאן.** |
| R4-10 | Primary navigation simplification | NEW | P1 | — | 01.09.2026 — לא נבדק בסבב הזה. שים לב ש-`ded53cc` שיחזר את ניווט המובייל אחרי רגרסיה; שינוי ניווט דורש את המטריצה ירוקה קודם. |

---

### Release 5 — Financial Clarity
**מטרה:** להבדיל בין Input, Calculated, Paid ו-Forecast.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R5-01 | User Input labeling | IN_REVIEW | P1 | **שורש 8** (הטיפוס נחת) · **חדש:** `apps/web/src/components/ValueOrigin.tsx` (`kind="input"`, תווית "הוזן") · מפתחות `valueOrigin.input.*` ב-`he.json`/`en.json` · יושם ב-`PayrollPage.tsx` (תשלום נוסף בסיכום החודשי; שדה "סכום בש״ח" כשהמשתמש דורס את החישוב; שורת הוצאה תקופתית) וב-`CanonicalPayrollIntelligence.tsx` (הוצאת תרחיש) · בדיקות: `ValueOrigin.test.tsx`, `PayrollPage.test.tsx` ("flips the amount field from calculated to entered…") | 01.09.2026 — סימון "הוזן" נחת. **הכלל שלפיו סווג**: ערך שהמשתמש הקליד ושהמערכת אינה גוזרת ממנו דבר. **לא `COMPLETE`**: §11 של נוהל השחרור דורש אימות בייצור שלא בוצע, ו-**vitest אינו ניתן להרצה בסביבה הזו** (`@rollup/rollup-linux-x64-gnu` חסר) — הבדיקות נכתבו ולא הורצו. הורצו כן: `tsc --noEmit` (web, i18n, application, domain), `eslint`, `prettier --check`, וכל סקריפטי `scripts/`. |
| R5-02 | Calculated labeling | IN_REVIEW | P1 | **שורש 8** · `ValueOrigin.tsx` (`kind="calculated"`, תווית "מחושב") · יושם ב-`PayrollPage.tsx` (שכר בסיס יחסי, תוספת שבתות, סך התוספות, סך הקיזוזים, שש שורות הסיכום החודשי, סכום ביטוח לאומי לכל חודש, שני סיכומי המחשבון, סה״כ הדוח השנתי), `PayrollIntelligence.tsx` (שלוש מדדי ה-YTD, חודש פתוח בתרשים, "סכום ששמור לתשלום"), `CanonicalPayrollIntelligence.tsx` ("סה״כ מחושב", חודש עם רשומה קנונית פתוחה) · בדיקות: `PayrollPage.test.tsx`, `PayrollIntelligence.test.tsx`, `CanonicalPayrollIntelligence.test.tsx` | 01.09.2026 — **הכלל שלפיו סווג**: כל ערך שהמערכת גזרה בנוסחה מערכים שהוזנו — **כולל סכום**, כי סכום הוא גזירה והמשתמש לא הקליד אותו. שורש 8 הוא מה שהופך את התווית לאמינה: השרת מחשב מחדש ודוחה אי-התאמה, ולפני כן התווית הייתה שקר. **לא `COMPLETE`** — כנ"ל. |
| R5-03 | Paid state clarity | IN_REVIEW | P1 | **שורש 8** · `ValueOrigin.tsx` (`kind="paid"`) · `PayrollIntelligence.tsx` (חודש עם `payroll_month_close` קנוני בתרשים ובהיסטוריית הסגירות, כולל תאריך התשלום), `CanonicalPayrollIntelligence.tsx` (עלות עתידית), `PayrollPage.tsx` (הוצאה שסומנה כשולמה) · e2e: `launch-readiness.spec.ts` עודכן מ-`בפועל` ל-`שולם` · בדיקות: `PayrollIntelligence.test.tsx` ("says שולם only for the month that has a canonical close") | 01.09.2026 — **הכלל שלפיו סווג**: קיימת רשומת תשלום עם תאריך. שני תיקונים ממשיים: (1) רצועת התחזית סימנה `בפועל` לכל חודש שיש לו רשומת שכר, סגור או לא — זו בדיוק הטענה השקרית שהפריט בא להסיר; (2) `annualReport.totalPaid` נקרא "שולם" בקוד אך הוא סכום רשומות **שנשמרו**, ולכן סומן `מחושב`. **פער נתונים שנמצא ולא תוקן**: `MvpEmploymentExpense` נושא `status: 'paid'` ללא תאריך תשלום, ולכן שורת הוצאה שסומנה כשולמה יכולה לומר מתי נרשמה ולא מתי שולמה. לא נוסף שדה. |
| R5-04 | Forecast state clarity | IN_REVIEW | P1 | **שורש 8** · `ValueOrigin.tsx` (`kind="forecast"`) · `PayrollIntelligence.tsx` (ארבעת מדדי תחזית 12 החודשים ורצועת החודשים), `CanonicalPayrollIntelligence.tsx` (עלות עתידית — חודש ללא סגירה וללא רשומה) · מפתחות `valueOrigin.forecast.*` · בדיקות: `PayrollIntelligence.test.tsx` ("marks every headline forecast figure as a forecast") | 01.09.2026 — עיקרון "Forecast אינו Actual" מיוצג עכשיו ליד המספר עצמו ולא רק ב-eyebrow בראש הכרטיס. **הכלל שלפיו סווג**: הערכה על חודש שטרם אירע. |
| R5-05 | Provenance display | PARTIAL | P1 | `apps/web/src/pages/DashboardPage.tsx` — המחרוזת הטכנית הוחלפה ב-`t('valueOrigin.provenance.source')` עם fallback ל-token הגולמי · `ValueOrigin` `provenance={{ source, who, when }}` · "מתי" אמיתי מוצג ב-`PayrollIntelligence.tsx` (תאריך תשלום מ-`payroll_month_close`) וב-`PayrollPage.tsx` (`savedAt` של הוצאה) · בדיקות: `ValueOrigin.test.tsx` (R5-05), `DashboardPage.test.tsx` ("names the source… in Hebrew", "falls back to the raw source token") | 01.09.2026 — נשאר `PARTIAL` **במכוון**. "מקור" ו-"מתי" מוצגים היכן שהנתון כבר נושא אותם. **"מי" אינו קיים באף אחד מהמקורות**: `HealthFactor.provenance` הוא `{sourceType, sourceIds}` בלבד, ו-`payroll_month_close` אינו נושא שחקן. הרכיב משמיט את החלק שאין לו נתון במקום למלא מציין מקום. סגירת הפריט דורשת החלטת מוצר על נשיאת actor — כלומר שינוי נתונים, שאינו ב-scope של סבב תצוגה. |
| R5-06 | Monthly Close human summary | NEW | P1 | `apps/web/src/components/PayrollIntelligence.tsx` · `packages/application/src/product-intelligence.ts` | 01.09.2026 — לא אומת סיכום אנושי. WEB-01 של שורש 5 ("סגירת חודש שכר לא עושה כלום") לא אומת כנסגר בסבב הזה — לא הצלחתי לאמת מהקוד שסגירת חודש כותבת בפועל. |
| R5-07 | Future Cost placement | NEW | P2 | — | 01.09.2026 — לא נבדק בסבב הזה. |

---

### Release 6A — Design Core
**מטרה:** Consistency ללא Redesign.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R6A-01 | Core design tokens | PARTIAL | P1 | `docs/governance/DESIGN-PALETTE-AUDIT.md` · `fa64b85` ("finish the palette pass", PR #105) | 01.09.2026 — מעבר הפלטה הושלם לפי הודעת ה-commit; לא אומת מכאן שכל צבע עובר דרך token. נשאר אחרי ה-gates. |
| R6A-02 | Surface / text / border primitives | NEW | P1 | | |
| R6A-03 | Success / warning / danger semantics | NEW | P1 | | |
| R6A-04 | Focus state consistency | NEW | P1 | | |
| R6A-05 | Home + Actions consolidation | NEW | P1 | | |

### Release 6B — Design Completion
| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R6B-01 | Payroll visual consolidation | NEW | P2 | | |
| R6B-02 | Documents visual consolidation | NEW | P2 | | |
| R6B-03 | Family visual consolidation | NEW | P2 | | |
| R6B-04 | Secondary routes consolidation | NEW | P2 | | |

---

### Release 7+ — Low-Cost Differentiation
כל Capability יכול לעלות ל-Production בנפרד.

| ID | נושא | Status | Priority | Evidence / Reference | Notes |
|---|---|---|---|---|---|
| R7-01 | Monthly Digest | NEW | P2 | | נגזר מנתונים קנוניים |
| R7-02 | Global Quick Add | NEW | P2 | | לא ליצור data model חדש |
| R7-03 | Smart Search / Command Search | NEW | P3 | | לא Chatbot |
| R7-04 | Smart Document Extraction | PARTIAL | P2 | Smart Document AI · ADR-003 | AI proposes, user confirms. 01.09.2026 — לא נבדק בסבב הזה. |
| R7-05 | Contextual AI Actions | NEW | P2 | case-aware AI | context-first |
| R7-06 | WhatsApp delivery | PARTIAL | P2 | notification foundation | תלוי provider |
| R7-07 | Emergency Binder packaging | PARTIAL | P2 | existing binder | שם משתמשי / export |
| R7-08 | Human escalation packaging | PARTIAL | P2 | existing foundation | לא Marketplace |

---

## 4א. מיפוי Backlog ↔ תשעת שורשי הביקורת

> **למה הסעיף הזה קיים.** ה-Backlog הזה ו-`REVIEW-REMEDIATION-PLAN.md` מתארים חלק מאותה עבודה בשמות שונים. בלי המיפוי הזה הפרויקט מנהל שתי רשימות מעל אותה עבודה, ומשלם עליה פעמיים. הכלל: **כשפריט Backlog ממופה לשורש, השורש הוא בעל הבית.** ה-Backlog מתאר את שכבת המוצר/UX מעליו, לא מחליף אותו.

| שורש | נושא השורש | פריטי Backlog הממופים | היחס |
|---|---|---|---|
| 1 | סביבה אחת לכל דבר | R0-01 | זהה |
| 2 | מערכת המיגרציות אינה אמינה | R0-02 | זהה |
| 3 | שני מודלי אחסון חיים במקביל | R0-04, ובעקיפין R2-01 | זהה. R2-01 (מודל action אחיד) חסום עד להכרעה |
| 4 | השרת סומך על הדפדפן | — (אין פריט Backlog) | תשתית בלבד; מזין את R5-02 |
| 5 | כתיבה יכולה להיכשל בשקט | **R1-05 (עיקרי)**, R1-01, R1-02, R1-03 | **R1-05 הוא בפועל שורש 5.** "חוזה כתיבה אחד" של השורש = R1-01+02+03 יחד |
| 6 | בידוד דיירים נאכף לא באופן אחיד | — (אין פריט Backlog) | תשתית בלבד; `scripts/check-tenant-db-path.mjs` |
| 7 | שחזור תוכנן ומעולם לא תורגל | R0-03 | זהה |
| 8 | כסף אינו מודל | **R5-01, R5-02, R5-03, R5-04** | **חלקי בלבד.** השורש נותן את *הטיפוס*; ה-Backlog נותן את *הסימון בממשק*. סגירת השורש אינה סוגרת את הפריטים |
| 9 | לממשק אין מודל כשל | **R1-04, R1-06**, וחצי מ-R1-05 | R1-04 = WEB-02 (טיוטת אשף), R1-06 = WEB-06, R1-05 = error boundary |
| — | מטריצת רוחבים (`RELEASE-GATE.md` §2, `WORK-PLAN-2026-08-29.md`) | **R4-09** ובנותיו R4-01..R4-08 | R4-09 הוא עבודת מטריצת הרוחבים. אין לפתוח לה פריט נוסף |

**פריטים שאינם ממופים לאף שורש** ולכן הם עבודת מוצר טהורה: R2-02..R2-07, R3-01..R3-06, R4-10, R5-05..R5-07, R6A-*, R6B-*, R7-*.

---

## 5. Explicit Non-Goals

כרגע לא בונים:
- Native App.
- Marketplace רחב.
- Chatbot AI גנרי.
- מערכת הנהלת חשבונות חדשה.
- מנוע משפטי אוטומטי רחב.
- Social features.
- Gamification.
- Redesign מלא.
- מקור אמת נוסף.
- Event types רבים חדשים לפני סגירת הקיימים.

---

## 6. Release Gates

### Gate R0 → R1
- Canonical storage מוכח.
- Migration אמינה.
- Restore מוכח.
- Environment separation מאומת.

> **מצב 01.09.2026 — השער פתוח.** שלושה מארבעת התנאים אינם מתקיימים: תרגיל השחזור מעולם לא הורץ (R0-03), פרויקט `caredesk-staging` לא נוצר (R0-01), ושני מודלי האחסון עדיין חיים במקביל (R0-04). למרות זאת נחתה ב-31.08 עבודת R1 (`c8b4175` — auto-save, error boundary) ועבודת R5/שורש 8 (טיפוס כסף). ראה R0-05.

### Gate R1 → R2
- אין silent save failures במסלולים המרכזיים.
- Auto-save / retry לפי Scope.
- idempotency לפעולות רגישות.

### Gate R2 → R3
- Home מראה Priority action.
- Action model אחיד.
- Score framing אינו מציג Legal Compliance.

### Gate R3 → R4
- אחריות משפחתית גלויה.
- Two-user browser journey עבר.

### Gate R4 → R5
- Mobile regression עבר במסלולים העיקריים.
- RTL ו-navigation תקינים.

### Gate R5 → R6
- Input / Calculated / Paid / Forecast מובחנים.
- Money regression עבר.

### Gate R6 → R7+
- Core UI עקבי.
- אין צורך ב-Redesign נוסף כדי להוסיף בידול.

---

## 7. Claude Update Protocol

בכל פעם שקלוד עובד על Release:

### לפני העבודה
- עדכן Status ל-`IN_PROGRESS`.
- הוסף Release target.
- הוסף Notes אם Scope השתנה.

### לאחר קוד ובדיקות
- עדכן ל-`IN_REVIEW`.
- הוסף PR/Commit.
- הוסף Tests/Evidence.

### לפני Production
- עדכן ל-`READY_FOR_PRODUCTION`.

### אחרי Deploy
- עדכן ל-`DEPLOYED`.
- הוסף גרסה/Commit שעלה.

### אחרי Smoke / Verification
- עדכן ל-`PRODUCTION_VERIFIED`.

### רק לאחר כל ה-Gates
- עדכן ל-`COMPLETE`.

---

## 8. Release Log

> Claude מוסיף שורה חדשה בכל Deploy. אין למחוק היסטוריה.

| Date | Release | Version / Commit | Status | Production Verification | Known Issues | Decision |
|---|---|---|---|---|---|---|
| 2026-08-31 | Backlog initialized | N/A | DOCUMENTATION | N/A | None | READY |
| 2026-09-01 | R5 — Financial Clarity (שכבת תצוגה בלבד) | טרם נדחף — ענף עבודה מעל `4c2c870` | IN_REVIEW | **לא בוצע** — אף פריט לא סומן `PRODUCTION_VERIFIED` או `COMPLETE` | (1) **vitest לא רץ בסביבה** (`@rollup/rollup-linux-x64-gnu` חסר) — כל הבדיקות שנכתבו בסבב הזה **לא הורצו**. הורצו: `tsc --noEmit`, `eslint`, `prettier --check`, וכל סקריפטי `scripts/`. (2) R5-05 נשאר `PARTIAL` — אין שדה "מי" באף מקור נתונים. (3) `MvpEmploymentExpense.status='paid'` ללא תאריך תשלום. (4) שער R0→R1 עדיין פתוח (R0-05) — סבב זה נחת מעליו, כמו הסבבים שלפניו. | **HOLD** — נדרש אימות חזותי בייצור (ראה §7 של נוהל השחרור) לפני `READY_FOR_PRODUCTION` |
| 2026-09-01 | R4 — הרחבת מטריצת הרוחבים למסכי הכסף ולמסכים שנותרו | טרם נדחף — ענף עבודה מעל `2924aa7` | IN_REVIEW | **לא בוצע** — אף פריט לא סומן `PRODUCTION_VERIFIED` או `COMPLETE` | (1) **Playwright אינו ניתן להרצה בסביבה הזו** (אין דפדפנים מותקנים, `node_modules` בנוי ל-Windows) — הספקים נכתבו ו**לא הורצו**. הורצו: `tsc --noEmit`, `eslint`, `prettier --check`, וכל שבעת סקריפטי `scripts/`. (2) הכללים החדשים (גלישה שנבלעת ב-`overflow-x: clip`, רצפת 48px, טקסט נחתך/מוסתר, תווית פקד) חלים גם על ששת המסכים הוותיקים — ייתכן שהריצה הראשונה תחשוף כשלים קיימים שם. זו מטרת השער; הודעת הכשל תנקוב בהם במספרים. (3) R4-05 נשאר `PARTIAL` — תהליך חידוש הוויזה ב-`/cases/:caseId` לא נכנס למטריצה. (4) שער R0→R1 עדיין פתוח (R0-05). | **HOLD** — נדרשת ריצה ירוקה של `pnpm --filter @caredesk/web test:e2e --project=layout-matrix` על מכונה עם דפדפנים לפני `READY_FOR_PRODUCTION` |
| 2026-09-01 | Reconciliation R0/R1 מול הקוד (ללא שינוי קוד) | `c8b4175` (HEAD) · נסקרו `e10c699` #111, `a335357` #110, `0116b43` #108, `fa64b85` #105, `c9d33d6`/`ded53cc` #104 | DOCUMENTATION | **לא בוצע** — אף פריט לא סומן `PRODUCTION_VERIFIED` או `COMPLETE` | (1) שער R0→R1 פתוח — R0-05. (2) `/ready` מאמת ש-`SUPABASE_URL` **מוגדר**, לא שהוא **נכון**; `authentication` דיווח `ok` לכל אורך ההשבתה של 31.08 — R0-08. (3) PR #112: 54 קבצים, שני שורשים, בניגוד ל-§1/§3 של נוהל השחרור — R0-06. (4) מטריצת הרוחבים מכסה 6 מסכים בלבד; שכר, מסמכים, ויזה, משפחה, תרופות והגדרות מחוצה לה — R4-03..R4-08. (5) **vitest לא ניתן להרצה בסביבה הזו** (`@rollup/rollup-linux-x64-gnu` חסר) — אף סטטוס במסמך זה אינו נשען על ריצת בדיקות שנצפתה. | **HOLD** — לפני R1+ נוסף נדרשת הכרעה על R0-05 |

---

## 9. Change Log

| Date | Changed by | Change |
|---|---|---|
| 2026-08-31 | Product | Initial Product & UX Improvement Backlog created |
| 2026-09-01 | Claude | **R5-01..R5-05 — שכבת התצוגה של סוג המספר.** נוסף רכיב יחיד `apps/web/src/components/ValueOrigin.tsx` (`ValueOrigin` + `ValueOriginLegend`) ומשפחת מפתחות אחת `valueOrigin.*` ב-`he.json` וב-`en.json`, והוחל על אשף השכר והסיכום החודשי, טבלת הביטוח הלאומי, ההוצאות התקופתיות, הדוח השנתי, `PayrollIntelligence` (מדדים, מגמה, תחזית, סגירת חודש, היסטוריית סגירות), `CanonicalPayrollIntelligence` (סה״כ מחושב, הוצאות תרחיש, עלות עתידית) ו-provenance של "דורש טיפול" ב-`DashboardPage`. ההבחנה אינה נשענת על צבע: מילה + אייקון בעל צורה נבדלת + משפט `sr-only`. **אין מקור אמת חדש, אין store, אין מיגרציה ואין שינוי בשום חישוב.** נוספה שכבה 3 ל-`LIABILITY-FRAMING.md`. עודכנו R5-01..04 ל-`IN_REVIEW` ו-R5-05 נשאר `PARTIAL` (אין "מי" בשום מקור). e2e `launch-readiness.spec.ts` עודכן: רצועת התחזית טוענת `שולם` לחודש סגור במקום `בפועל` לכל חודש עם רשומה. הבדיקות **לא הורצו** — vitest אינו ניתן להרצה בסביבה. |
| 2026-09-01 | Claude | **R4-04 (ובעקבותיו R4-03, R4-06..R4-09) — הרחבת מטריצת הרוחבים למסכים שלא נמדדו.** הפער שה-Reconciliation מצא לא היה הרוחבים אלא המסכים: שבעת הרוחבים היו קיימים, ששה מסכים בלבד נמדדו. נוספו שני טסטים לכל רוחב ב-`responsive-width-matrix.spec.ts` — אשף השכר על חמשת שלביו + תצוגה מקדימה להדפסה + הדוח השנתי לאחר שמירה + טבלת הביטוח הלאומי (שנמצאת באותו route ולכן נמדדת בכל שלב), ובנפרד מסמכים (כולל טופס ההעלאה), תרופות, הגדרות, נושאים פתוחים ובני משפחה. סה״כ 19 מסכים × 7 רוחבים. ב-`fixtures/layout-matrix.ts` תוקן כלל הגלישה (שלא היה מסוגל להיכשל מתחת ל-761px בגלל `overflow-x: clip`), הועלתה רצפת מטרת המגע במובייל ל-48px לפקדים ש-`global.css` מבטיח להם 48, ונוספו שלושה כללים: טקסט נחתך, טקסט מוסתר מאחורי רכיב אחר, ופקד טופס ללא תווית נגישה או עם תווית שיוצאת מגבולות המסך. `SUBPIXEL_TOLERANCE_PX` נשאר מוצהר בתוך `collectLayoutSnapshot` — Playwright מסריאל את הפונקציה ו-scope המודול אינו קיים בזמן ריצה. **תיקון CSS יחיד:** `.top-actions .font-size-controls button` היה 42×42 מתחת ל-761px, מתחת לשתי הרצפות; הוחזר ל-48×48. **הבדיקות לא הורצו** — Playwright אינו ניתן להרצה בסביבה הזו. |
| 2026-09-01 | Claude | Reconciliation ראשון מול הקוד לפי סעיף 1. עודכנו Status/Evidence/Notes ב-38 שורות קיימות; לא נמחקה אף שורה. נוספו R0-05 (שער R0→R1 פתוח), R0-06 (סטיית Big Bang ב-PR #112), R0-07 (`/ready` מנמק את כשל המסד) ו-R0-08 (`/ready` לא מאמת נכונות SUPABASE_URL). נוסף סעיף 4א — מיפוי Backlog ↔ תשעת השורשים, ובו נקבע ש-R1-05 הוא שורש 5, ש-R5-01..04 הם רק שכבת התצוגה של שורש 8, וש-R4-09 היא עבודת מטריצת הרוחבים. נוספה הערת מצב לשער R0→R1. לא שונה קוד אפליקציה. |
