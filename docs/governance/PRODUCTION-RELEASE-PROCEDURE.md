# CareDesk — Production Release Procedure
## נוהל מעבר גרסה מסודר ל-Production
**גרסה:** 1.0  
**תאריך:** 31.08.2026  
**מטרה:** לוודא שכל גרסה עוברת תהליך אחיד, מדיד, הפיך ומתועד לפני ואחרי עלייה לייצור.

---

## 1. עקרונות יסוד

כל Release חייב להיות:
- קטן מספיק לבדיקה ולהבנה.
- בעל Scope מוגדר ו-Non-scope מוגדר.
- מבוסס על Source of Truth קנוני.
- ניתן ל-Rollback.
- בעל Evidence לסגירה.
- מאומת בפועל ב-Production לאחר Deploy.
- מתועד ב-`PRODUCT-UX-IMPROVEMENT-BACKLOG.md`.

אין לבצע Big Bang Release.

---

## 2. תנאי פתיחה לכל Release

לפני כתיבת קוד או Merge:
- [ ] נקרא `docs/governance/REVIEW-REMEDIATION-PLAN.md`.
- [ ] נקרא `DEPLOYMENT.md`.
- [ ] נבדקו ADR ו-`SOURCE_OF_TRUTH.md` אם השינוי נוגע לנתונים/ישויות.
- [ ] נבדק המצב בפועל בקוד ולא רק בתיעוד.
- [ ] סומנו משימות ה-Release ב-Backlog.
- [ ] לכל משימה הוגדרו Acceptance Criteria.
- [ ] הוגדר במפורש מה אינו נכנס לגרסה.
- [ ] לא נוצרת כפילות ליכולת קיימת או משימה שכבר תוכננה.
- [ ] אין שינוי Source of Truth ללא החלטה מפורשת.

---

## 3. Branch / PR Discipline

מומלץ:
- Release אחד = מספר PRs קטנים לפי bounded concern.
- אין ענף ענק עם מספר תחומים לא קשורים.
- אין Refactor רחב שאינו נדרש למשימה.
- PR צריך להיות Reviewable בפני עצמו.

לכל PR:
- [ ] תיאור הבעיה.
- [ ] מה השתנה.
- [ ] מה לא השתנה.
- [ ] בדיקות שבוצעו.
- [ ] סיכוני Regression.
- [ ] קישור למשימת Backlog.

---

## 4. בדיקות חובה לפני Merge

לפי רלוונטיות:
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] Browser journey.
- [ ] Permissions / role checks.
- [ ] Failure state.
- [ ] Save / retry / idempotency.
- [ ] Mobile 360 / 390 / 430.
- [ ] Tablet 768.
- [ ] Desktop 1024 / 1440 / 2560.
- [ ] RTL.
- [ ] Keyboard / focus.
- [ ] No unexpected horizontal scroll.
- [ ] No silent failure.
- [ ] No duplicate records on repeated submission.
- [ ] Regression על מסלולים קיימים שהושפעו.

---

## 5. Gate לפני Deploy

אין Deploy אם אחד מהבאים פתוח ללא החלטה:
- קיימת סכנת פגיעה בנתוני Production.
- קיימת אי-בהירות לגבי Source of Truth.
- מיגרציה לא נבדקה.
- אין Rollback path.
- Browser journey מרכזי נכשל.
- שמירה יכולה להיכשל בשקט.
- הרשאות אינן מאומתות.
- Known issue משמעותי אינו מתועד.

לפני Deploy:
- [ ] Commit/Tag/Version מזוהים.
- [ ] Migration plan מאושר אם נדרש.
- [ ] Rollback instructions כתובים.
- [ ] רשימת Smoke Tests מוכנה.
- [ ] Backlog עודכן ל-`READY_FOR_PRODUCTION`.

---

## 6. Deploy ל-Production

בעת Deploy:
- [ ] נפרסה הגרסה המתוכננת בלבד.
- [ ] לא צורפו שינויים לא קשורים.
- [ ] Migration, אם קיימת, הסתיימה בהצלחה.
- [ ] `/ready` / health checks תקינים.
- [ ] אין שגיאות חריגות מיידיות בלוגים.

---

## 7. Smoke Test לאחר Deploy

יש לבצע מיד לאחר העלייה, לפי ה-Scope של הגרסה.

Baseline מומלץ:
- [ ] Login.
- [ ] פתיחת תיק קיים.
- [ ] Home / Dashboard.
- [ ] יצירה או עדכון של Action רלוונטי.
- [ ] Payroll אם הושפע.
- [ ] Document upload אם הושפע.
- [ ] Family action אם הושפע.
- [ ] Monthly Close אם הושפע.
- [ ] Save state מוצג נכון.
- [ ] Error state / retry נבדק אם ניתן.
- [ ] Mobile smoke test.
- [ ] RTL smoke test.

---

## 8. Production Verification Window

לא מסמנים Release כ-COMPLETE מיד לאחר Deploy.

סטטוסים:
`READY_FOR_PRODUCTION` → `DEPLOYED` → `PRODUCTION_VERIFIED` → `COMPLETE`

כדי לעבור ל-`PRODUCTION_VERIFIED`:
- [ ] Smoke tests עברו.
- [ ] אין שגיאה קריטית חדשה.
- [ ] הנתונים נשמרים ונקראים מאותו Source of Truth.
- [ ] אין Regression ידוע במסלול המרכזי.
- [ ] Evidence נשמר.

---

## 9. Rollback

אם מתגלה בעיה משמעותית:
1. עצור הרחבת Scope.
2. סווג חומרה.
3. אם קיים סיכון לנתונים או למסלול קריטי — בצע Rollback.
4. תעד:
   - גרסה שהוחזרה.
   - סיבה.
   - זמן.
   - השפעה.
   - האם נדרשת פעולת Data Repair.
5. פתח/עדכן משימה ב-Backlog.

אין "תיקון תוך כדי" ב-Production ללא תיעוד.

---

## 10. Release Report חובה

בסיום כל Release יש להוסיף ל-Backlog או למסמך Release Note:

### Implemented
מה יושם בפועל.

### Not Implemented
מה נשאר בחוץ במכוון.

### Tests
בדיקות ותוצאות.

### Production Verification
מה נבדק לאחר Deploy.

### Known Issues
בעיות ידועות.

### Rollback
איך חוזרים לגרסה הקודמת.

### Documentation
אילו מסמכי governance עודכנו.

### Evidence
קישורי Commit / PR / Test / Screenshot / Log בהתאם למדיניות הפרויקט.

### Decision
`GO` / `HOLD` לסבב הבא.

---

## 11. Definition of Done

משימה אינה `DONE` בגלל שקיים קוד.

משימה עוברת ל-`COMPLETE` רק כאשר:
- [ ] עובדת מול Source of Truth הנכון.
- [ ] Save state אמין.
- [ ] Failure state קיים.
- [ ] הרשאות מאומתות.
- [ ] RTL תקין.
- [ ] Mobile תקין.
- [ ] Browser journey עבר.
- [ ] Regression עבר.
- [ ] Production verification עבר.
- [ ] Documentation עודכן.
- [ ] Evidence קיים.

---

## 12. Status Model אחיד

הסטטוסים המותרים ב-Backlog:

- `NEW`
- `ALREADY_PLANNED`
- `PARTIAL`
- `BLOCKED`
- `READY_FOR_WORK`
- `IN_PROGRESS`
- `IN_REVIEW`
- `READY_FOR_PRODUCTION`
- `DEPLOYED`
- `PRODUCTION_VERIFIED`
- `COMPLETE`
- `REJECTED`
- `LATER`

אין להשתמש ב-`DONE` כסטטוס עמום.

---

## 13. כלל לקלוד

בכל מעבר גרסה:
1. עדכן את `PRODUCT-UX-IMPROVEMENT-BACKLOG.md`.
2. אל תשנה סטטוס ל-`COMPLETE` ללא Evidence.
3. רשום Release ו-PR/Commit בכל פריט ששונה.
4. אם מתגלה פער חדש — הוסף שורה חדשה, אל תסתיר אותו בתוך Notes של משימה אחרת.
5. אם פריט כבר מכוסה ב-Remediation קיים — סמן `ALREADY_PLANNED` וקשר למקור במקום ליצור כפילות.
