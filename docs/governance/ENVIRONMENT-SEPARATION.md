# הפרדת סביבות — הפעולות הידניות שרק אתה יכול לבצע

> **הכלל:** תהליך שאינו ייצור לא נוגע בנתוני ייצור. לא בטעות, לא "רק לרגע", לא כדי לבדוק משהו.
> נכון להיום יש בייצור נתונים של לקוח אמיתי, ואין להם עותק שאפשר לחזור אליו.

מקור: שורש 1 בתוכנית `REVIEW-REMEDIATION-PLAN.md` — הממצאים REL-02, REL-10, REL-11, REL-12, DB-03, DR-08.

נכתב: 30.8.2026

---

## מה כבר נסגר בקוד, ומה נשאר לך

הקוד עושה עכשיו שני דברים שהוא לא עשה קודם:

1. **ה-API מסרב לעלות** כשפריסה שאינה ייצור מקבלת את מסד הייצור, וכשפריסת ייצור חסרה מסד או אימות.
2. **`pnpm db:rls-test` מסרב לרוץ** מול פרויקט הייצור, בכל הגדרה שהיא.

שני המנגנונים האלה משווים **project ref** — המזהה בן עשרים התווים של פרויקט Supabase. הם יודעים מהו ה-ref של הייצור רק ממשתנה אחד: `PRODUCTION_SUPABASE_PROJECT_REF`. **בלי המשתנה הזה שני המנגנונים לא חמושים.**

מה שנשאר הוא בדיוק שלושה דברים, וכולם ידניים: ליצור פרויקט Supabase שני, לפצל את משתני הסביבה ב-Vercel, ולוודא ששום משתנה לא נשאר על "All Environments".

**סדר הפעולות בפרק 5 אינו שרירותי.** מי שמשנה קודם את משתני ה-Vercel ורק אחר כך יוצר את הפרויקט השני, משאיר את ה-preview בלי מסד — ואם באותו רגע ה-ref עוד לא מוגדר, ה-API של ה-preview פשוט לא יעלה. זה לא נזק, אבל זה מבלבל.

---

## 1. מהו project ref ואיפה מוצאים אותו

ה-ref הוא רצף של עשרים אותיות ומספרים קטנים. הוא מופיע בכל כתובת של הפרויקט:

```
https://abcdefghijklmnopqrst.supabase.co
                ^^^^^^^^^^^^^^^^^^^^ זה ה-ref
postgresql://caredesk_app.abcdefghijklmnopqrst:<סיסמה>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
                          ^^^^^^^^^^^^^^^^^^^^ ואותו ref גם כאן
```

**איפה למצוא:** Supabase Dashboard → בחר את הפרויקט → Settings → General → השדה `Reference ID`.

**ה-ref אינו סוד.** הוא מופיע בכל מחרוזת חיבור וגם בכתובת ה-API שהדפדפן רואה. לכן הוא המשתנה **היחיד** במסמך הזה שנכון להגדיר על כל הסביבות יחד — דווקא ההגדרה הרוחבית שלו היא מה שמאפשר ל-preview לזהות שקיבל את מסד הייצור.

רשום לעצמך עכשיו, לפני שאתה ממשיך:

| | ref |
|---|---|
| ייצור (הפרויקט הקיים) | `_______________________` |
| בדיקות (הפרויקט שתיצור בפרק 2) | `_______________________` |

---

## 2. יצירת פרויקט Supabase שני

הפרויקט הזה הוא מקום להיכשל בו. הוא לא מגבה שום דבר ואינו מחליף גיבוי.

1. Supabase Dashboard → **New project**.
2. Name: `caredesk-staging`. שם שאי אפשר לבלבל בינו לבין הייצור כשעייפים בשתיים בלילה.
3. Region: **אותו region כמו הייצור**. הבדל ב-region משנה את זמני התגובה ולכן הופך את הבדיקה לפחות מייצגת.
4. Database Password: סיסמה חדשה. **לא זו של הייצור.** אם אותה סיסמה משמשת בשני הפרויקטים, טעות העתקה בין מחרוזות חיבור לא תיעצר.
5. אחרי היצירה: Settings → General → העתק את ה-`Reference ID` אל הטבלה בפרק 1.

### הכנת הסכימה בפרויקט החדש

בפרויקט החדש אין טבלאות. יש להריץ בו את אותן מיגרציות:

```
# בקובץ .env.local, זמנית, עם פרטי פרויקט הבדיקות בלבד:
DATABASE_ADMIN_URL=<owner connection של caredesk-staging>
pnpm db:migrate
pnpm db:provision-app-role
```

לאחר מכן **החזר את `.env.local` למצבו הקודם**. קובץ שנשאר מצביע חצי לכאן וחצי לשם הוא המקור הנפוץ ביותר לתאונה מהסוג הזה.

### דלי האחסון

Storage → New bucket → שם `caredesk-private-documents`, **Private**. ללא הדלי הזה ה-API של ה-preview לא יעלה, כי `SUPABASE_STORAGE_BUCKET` נדרש בכל פריסה.

---

## 3. פיצול משתני הסביבה ב-Vercel

ב-Vercel יש שלושה scopes נפרדים לכל משתנה: **Production**, **Preview**, **Development**. משתנה שמוגדר על "All Environments" מגיע לשלושתם — וזה בדיוק המצב שיוצר את התקלה.

המסלול בממשק: Vercel → הפרויקט → **Settings** → **Environment Variables**.

### פרויקט `care-platform-api`

| משתנה | Production | Preview | Development |
|---|---|---|---|
| `DATABASE_URL` | חיבור `caredesk_app` של הייצור | חיבור `caredesk_app` של `caredesk-staging` | של `caredesk-staging` |
| `SUPABASE_URL` | `https://<ref-ייצור>.supabase.co` | `https://<ref-בדיקות>.supabase.co` | של הבדיקות |
| `SUPABASE_PUBLISHABLE_KEY` | של הייצור | של הבדיקות | של הבדיקות |
| `SUPABASE_SERVICE_ROLE_KEY` | של הייצור | של הבדיקות | של הבדיקות |
| `SUPABASE_STORAGE_BUCKET` | `caredesk-private-documents` | `caredesk-private-documents` | זהה |
| `BACKUP_SUPABASE_*` | של פרויקט הגיבוי | של הבדיקות, או של הבדיקות עצמו | זהה |
| `WORKSPACE_ENCRYPTION_KEY` | מפתח הייצור | **מפתח אחר** | מפתח אחר |
| `PRODUCTION_SUPABASE_PROJECT_REF` | ← **על כל הסביבות, אותו ערך: ה-ref של הייצור** → | | |
| `CORS_ORIGINS` | `https://caredesk-isr.com,...` | להוסיף את מארח ה-preview | לא רלוונטי |

שים לב ל-`WORKSPACE_ENCRYPTION_KEY`: אם ה-preview מקבל את מפתח הייצור, כשל בהגדרת `DATABASE_URL` יאפשר לו גם **לפענח** נתוני לקוח, לא רק להגיע אליהם. מפתח נפרד הופך את הטעות הבאה לבלתי מזיקה. צור אותו עם `openssl rand -base64 32`.

`BACKUP_SUPABASE_*` בפרויקט הבדיקות אינו חייב להיות פרויקט שלישי — הוא רק חייב **לא** להיות פרויקט הגיבוי של הייצור.

### פרויקט `care-platform-web`

| משתנה | Production | Preview |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref-ייצור>.supabase.co` | `https://<ref-בדיקות>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | של הייצור | של הבדיקות |
| `VITE_API_BASE_URL` | `https://care-platform-api.vercel.app` | כתובת ה-preview של פרויקט ה-API |
| `VITE_PUBLIC_SITE_URL` | `https://caredesk-isr.com` | כתובת ה-preview של פרויקט ה-web |

`VITE_*` נצרב לתוך ה-bundle בזמן ה-build. אין ל-`VITE_SUPABASE_PUBLISHABLE_KEY` הגנה של סוד — אבל אם ה-preview נצרב עם המפתח של הייצור, כל מי שפותח אותו מדבר עם Auth של הייצור. הפיצול נדרש גם כאן.

**`SUPABASE_SERVICE_ROLE_KEY` לעולם לא בפרויקט ה-web ולעולם לא כמשתנה `VITE_`.** זהו מפתח שרת שעוקף את כל מדיניות ה-RLS.

### איך משנים scope של משתנה קיים

Vercel לא מאפשר לערוך את ה-scope של משתנה קיים ישירות. עבור כל משתנה שמוגדר היום על All Environments:

1. העתק את הערך הנוכחי לצד.
2. מחק את המשתנה.
3. **Add New** → הזן את הערך של הייצור → סמן **רק** `Production` → Save.
4. **Add New** שוב → אותו שם, ערך של הבדיקות → סמן `Preview` **וגם** `Development` → Save.

אחרי כל שינוי משתנה יש לבצע **Redeploy** — Vercel אינו מחיל משתנים על פריסה קיימת. Deployments → הפריסה האחרונה → תפריט `...` → Redeploy → **ודא ש-"Use existing Build Cache" כבוי**.

---

## 4. איך מוודאים ששום משתנה לא נשאר על "All Environments"

זו הבדיקה שסוגרת את הפער. בלעדיה כל מה שלמעלה הוא הצהרת כוונות.

### בדיקה ויזואלית

בכל אחד משני הפרויקטים, Settings → Environment Variables: לצד כל משתנה מופיעות התוויות שלו. חפש בעיניים את התווית **`All Environments`**. היא מותרת **רק** על `PRODUCTION_SUPABASE_PROJECT_REF`. כל הופעה אחרת שלה היא תקלה פתוחה.

### בדיקה מדויקת דרך ה-CLI

הבדיקה הוויזואלית מפספסת כשיש עשרים משתנים ברשימה נגללת. זו לא:

```
npx vercel login
npx vercel link            # בחר את הפרויקט care-platform-api
npx vercel env ls
```

הפלט הוא טבלה עם עמודת `Environments`. **כל שורה שכתוב בה `Production, Preview, Development` — למעט `PRODUCTION_SUPABASE_PROJECT_REF` — היא ממצא.** חזור על אותו הליך עבור `care-platform-web`.

### הבדיקה שמאשרת שההפרדה אמיתית

הרשימות מוכיחות מה מוגדר. הבדיקה הזו מוכיחה מה קורה בפועל:

1. פתח branch כלשהו, דחוף commit ריק, המתן לפריסת ה-preview של פרויקט ה-API.
2. פתח את `https://<כתובת-ה-preview>/health`.
3. **התוצאה הנדרשת:** 200 תקין. אם חוזר `503` עם `startup_failed` — קרא את ההודעה: היא אומרת במפורש איזה משתנה חסר או שה-`DATABASE_URL` מצביע על הייצור. זה המנגנון עובד.
4. פתח `https://<כתובת-ה-preview>/readiness` וּודא ש-`database` הוא `ok` — כלומר ה-preview מחובר למסד **שלו**.
5. צור בסביבת ה-preview לקוח פיקטיבי, ואז ודא בממשק הייצור שהוא **אינו** מופיע שם.

שלב 5 הוא היחיד שבודק את הדבר עצמו. אל תדלג עליו.

---

## 5. סדר הביצוע

1. רשום את שני ה-refs (פרק 1).
2. צור את `caredesk-staging`, הרץ מיגרציות, צור את הדלי (פרק 2).
3. הגדר `PRODUCTION_SUPABASE_PROJECT_REF` על **כל** הסביבות בשני הפרויקטים.
4. פצל את שאר המשתנים (פרק 3).
5. Redeploy לשני הפרויקטים, בלי build cache.
6. הרץ את כל ארבע הבדיקות שבפרק 4.
7. עדכן ב-`DEPLOYMENT.md` שהמשתנים מפוצלים, וסמן ב-`docs/operations/production-release-and-recovery.md` שחוסם ההשקה "staging and production still need separate Supabase projects" נסגר.

---

## 6. הכללים שנשארים בתוקף אחרי שסיימת

**`pnpm db:rls-test` לא רץ מול ייצור. אף פעם.** הסקריפט כותב ומוחק בכ-40 טבלאות דרך חיבור בעל BYPASSRLS. הקוד מסרב לרוץ מול ה-ref של הייצור וזה אינו ניתן לעקיפה. כדי להריץ אותו מול `caredesk-staging`:

```
PRODUCTION_SUPABASE_PROJECT_REF=<ref-ייצור>
CAREDESK_RLS_TEST_ALLOW_REMOTE=1
CAREDESK_RLS_TEST_PROJECT_REF=<ref-בדיקות>
```

שלושתם נדרשים. חסר אחד — הסקריפט נעצר.

**בקובץ `.env.local` שעל המחשב שלך, הגדר `PRODUCTION_SUPABASE_PROJECT_REF`.** ברגע שהוא מוגדר, `pnpm dev:api` יסרב לעלות אם `DATABASE_URL` מצביע על הייצור. בלעדיו — המנגנון כבוי במחשב שלך, וזו הסביבה שבה טעויות ההעתקה קורות.

**`DATABASE_ADMIN_URL` של הייצור אינו יושב ב-Vercel.** הוא נדרש רק ל-`db:migrate` ול-`db:provision-app-role`, שרצים ידנית ממחשבך. ה-API לעולם אינו קורא אותו.

---

## 7. מה המסמך הזה לא פותר

- **REL-11 — סחף גרסאות בין web ל-API.** שני הפרויקטים נפרסים בנפרד מאותה דחיפה, ואין דבר שמוודא ששניהם מגישים את אותו commit. ההפרדה כאן לא נוגעת בזה.
- **REL-12 — אין דגלי פיצ'רים.** כל שינוי שממוזג חי אצל כל הלקוחות מיד. פרויקט בדיקות נותן מקום לתרגל שינוי לפני ההשקה; הוא אינו נותן דרך לכבות אותו אחריה.

שניהם נשארים פתוחים ומטופלים בנפרד.
