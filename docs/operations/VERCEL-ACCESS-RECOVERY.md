# שחזור הגישה ל-Vercel — מדריך מלא

**עודכן:** 01.09.2026
**מיועד ל:** בעל החשבון (BN)
**מצב:** הגישה חסומה מאחורי אימות דו-שלבי (2FA)

---

## למה זה דחוף — במספרים

זה לא פריט תחזוקה. **כל עוד אין גישה, שלושה דברים לא קורים:**

| מה חסום | ההשלכה | דחיפות |
|---|---|---|
| `CRON_SECRET` לא מוגדר | **הגבייה החוזרת של Cardcom לא רצה.** לקוחות לא מחויבים. | **הכי יקר ברשימה** |
| `SUPPORT_FROM_EMAIL` לא מוגדר | מיילים יוצאים מ-`onboarding@resend.dev` במקום מכתובת CareDesk | בינונית |
| אין פרויקט `caredesk-staging` | R0-01 חסום → שער R0→R1 נשאר פתוח → **אי אפשר לתרגל את מיגרציית האחסון** | חוסמת פיתוח |

**בשורה אחת:** בזמן שזה חסום, אנחנו לא גובים כסף ולא יכולים להתקדם בבטחה.

---

## קישורים ישירים — הדבק בשורת הכתובת

**מסלול הראשי (Vercel):**

| מה | קישור |
|---|---|
| **שחזור חשבון — 2FA אבוד** ← **התחל כאן** | `https://vercel.com/accountrecovery?userType=existing&problemType=lost-2fa` |
| כניסה (ומשם "Continue with GitHub") | `https://vercel.com/login` |
| הגדרות 2FA וקודי גיבוי (אחרי שנכנסת) | `https://vercel.com/account/security` |
| תיעוד רשמי על 2FA | `https://vercel.com/docs/two-factor-authentication` |
| טופס תמיכה כללי | `https://vercel.com/help` |

**חיפוש הסיסמה וקודי הגיבוי — לפי הכלי שאתה משתמש בו:**

| איפה | קישור ישיר |
|---|---|
| **Gmail — כל מה מ-Vercel** | `https://mail.google.com/mail/u/0/#search/from%3Avercel.com` |
| **Gmail — קודי גיבוי בלבד** | `https://mail.google.com/mail/u/0/#search/from%3Avercel.com+recovery` |
| **Chrome — סיסמאות** | `chrome://password-manager/passwords` ← **הדבק בשורת הכתובת, קישור כזה לא ניתן ללחיצה** |
| **Edge — סיסמאות** | `edge://wallet/passwords` |
| **Bitwarden** | `https://vault.bitwarden.com/#/vault?search=vercel` |
| **1Password** | `https://my.1password.com/` → חפש `vercel` |
| **LastPass** | `https://lastpass.com/vault/` → חפש `vercel` |
| **Apple / iCloud Keychain** | `https://www.icloud.com/settings/` → Sign-In and Security → Passwords |

> **שים לב:** `chrome://` ו-`edge://` הם קישורים פנימיים של הדפדפן. **לחיצה עליהם לא תעבוד — צריך להעתיק ולהדביק בשורת הכתובת.** זו מגבלת אבטחה של הדפדפן, לא תקלה.

---

## שלב 1 — שתי בדיקות של שתי דקות, לפני שפונים לתמיכה

**נסה את שתיהן לפני כל דבר אחר.** בהרבה מקרים אחת מהן פותרת הכול, ואז אין צורך בשלבים 2–3.

### 1.1 — כניסה דרך GitHub

1. פתח `https://vercel.com/login`
2. **אל תזין אימייל וסיסמה.** לחץ על **"Continue with GitHub"**
3. אם החשבון שלך מחובר ל-GitHub — ייתכן שתיכנס ישירות

**למה זה עובד לפעמים:** מסלול ה-OAuth של GitHub לא תמיד עובר דרך מנגנון ה-2FA של Vercel עצמו. אם ה-2FA של GitHub שלך נגיש, אתה בפנים.

> **תנאי:** דורש שה-2FA של **GitHub** יהיה נגיש לך. אם גם הוא אבוד — דלג ל-1.2.

### 1.2 — חיפוש קודי גיבוי במנהל הסיסמאות

Vercel מנפיק **8 קודי גיבוי** בעת הפעלת 2FA. מנהלי סיסמאות שומרים אותם אוטומטית לעיתים קרובות, בלי שהמשתמש שם לב.

חפש `Vercel` בכל אחד מאלה שיש לך:

- מנהל הסיסמאות (1Password / Bitwarden / LastPass / Dashlane)
- **סיסמאות Google Chrome** — `chrome://password-manager/passwords`
- **הערות** — חפש "Vercel", "backup code", "recovery code"
- **המייל שלך** — חפש `from:vercel.com` סביב התאריך שבו הפעלת 2FA
- קובץ טקסט או צילום מסך בתיקיית ההורדות

**איך נראה קוד גיבוי:** שמונה תווים, לרוב בפורמט `xxxx-xxxx`.

**אם מצאת:** בעמוד ה-2FA לחץ **"Use a recovery code"** והזן אותו. **קוד מתבזבז לאחר שימוש** — רשום את הנותרים במקום בטוח מיד.

---

## שלב 2 — פנייה לתמיכה

**רק אם שלב 1 נכשל בשתי הבדיקות.**

**לאן — יש טופס ייעודי בדיוק למקרה הזה, השתמש בו ולא בטופס הכללי:**

```
https://vercel.com/accountrecovery?userType=existing&problemType=lost-2fa
```

**חלופה:** `https://vercel.com/help` או `support@vercel.com`

> **ציפייה מציאותית לזמנים:** בפורום התמיכה של Vercel מדווחים מקרים של שחזור 2FA שנמשכו **מעל שבוע**, כולל אצל לקוחות Pro עם אפליקציית ייצור מושבתת. **אל תתכנן על יומיים.** זו הסיבה שסעיף 1 (GitHub וקודי גיבוי) שווה את עשר הדקות שהוא לוקח, ושכדאי לשלוח את הפנייה **היום** גם אם אתה עדיין מחפש.

### 2.1 — מה לכתוב

נושא הפנייה:

```
Account recovery — 2FA device lost — cannot access production project
```

גוף הפנייה (העתק והתאם):

```
Hello,

I have lost access to my two-factor authentication device and cannot
sign in to my Vercel account.

Account email:   <המייל הרשום ב-Vercel>
Projects:        care-platform-web, care-platform-api
Custom domain:   caredesk-isr.com

This is blocking a production deployment for a live customer: a required
environment variable (CRON_SECRET) cannot be set, and recurring billing
is not running as a result.

I can prove ownership by any of the following, please tell me which you
need:
  - access to the registered email inbox
  - control of DNS for caredesk-isr.com (I can publish a TXT record)
  - the last four digits of the payment method on file
  - a recent invoice number

Thank you,
<שם מלא>
```

### 2.2 — מה לצרף כבר בפנייה הראשונה

**זה מה שמקצר תהליך אימות ידני משבוע ליום.** ככל שתצרף יותר, כך מהר יותר:

| ראיה | למה היא חזקה | איך משיגים |
|---|---|---|
| **שליטה ב-DNS של `caredesk-isr.com`** | **הראיה החזקה ביותר.** רק הבעלים יכול לפרסם רשומת TXT | היכנס לרשם הדומיין; היה מוכן להוסיף TXT לפי בקשתם |
| גישה מוכחת לתיבת המייל הרשומה | הם ישלחו אליה קוד | ודא שאתה יכול לפתוח אותה עכשיו |
| ארבע ספרות אחרונות של אמצעי התשלום | קושר אותך לחיוב | מדף כרטיס האשראי |
| מספר חשבונית אחרונה | חותמת זמן שרק לקוח מכיר | חפש `from:vercel.com` + "invoice" במייל |
| שמות הפרויקטים המדויקים | `care-platform-web`, `care-platform-api` | כבר כתוב למעלה |

> **טיפ:** אל תשלח **צילום** של כרטיס אשראי ואל תכתוב מספר כרטיס מלא. **ארבע ספרות אחרונות בלבד.**

### 2.3 — כמה זמן זה לוקח

תלוי בסוג התוכנית. בתוכנית חינמית (Hobby) התגובה איטית יותר. **אם יש חיוב פעיל — ציין זאת בפנייה**, זה משנה את סדר העדיפויות אצלם.

**אם אין תשובה תוך 3 ימי עסקים:** שלח תזכורת באותו שרשור. אל תפתח פנייה חדשה — זה מאפס את התור.

---

## שלב 3 — מה לעשות מיד כשהגישה חוזרת

**בסדר הזה. הראשון משחרר כסף.**

### 3.1 — `CRON_SECRET` — משחרר את הגבייה החוזרת

1. `vercel.com` → פרויקט **`care-platform-api`**
2. **Settings** → **Environment Variables**
3. **Add New**:
   - **Key:** `CRON_SECRET`
   - **Value:** מחרוזת אקראית ארוכה — צור אותה כך בטרמינל:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - **Environments:** סמן **Production** בלבד
4. **Save**
5. **חובה:** **Deployments** → הפריסה האחרונה → **⋯** → **Redeploy**

> **בלי ה-Redeploy המשתנה לא נכנס לתוקף.** משתני סביבה נקראים בזמן הפריסה, לא בזמן ריצה.

**איך יודעים שזה עבד:** אחרי הפריסה, `GET /ready` בייצור לא אמור לכלול סיבה שקשורה ל-cron.

### 3.2 — `SUPPORT_FROM_EMAIL`

אותו מסלול, באותו פרויקט:

- **Key:** `SUPPORT_FROM_EMAIL`
- **Value:** `support@caredesk-isr.com`
- **Environments:** Production
- ואז **Redeploy**

> **תנאי מקדים:** הדומיין `caredesk-isr.com` חייב להיות מאומת ב-Resend, אחרת המיילים יידחו. אם הוא לא מאומת — השאר את הערך הקיים עד שיאומת.

### 3.3 — קודי גיבוי חדשים — כדי שזה לא יקרה שוב

**אל תדלג על זה. זה הצעד שמונע את החזרה על כל המסמך הזה.**

1. `vercel.com/account/security` (או **Settings** → **Authentication**)
2. **Two-Factor Authentication** → **Regenerate recovery codes**
3. **מיד:** שמור את שמונת הקודים בשני מקומות נפרדים:
   - מנהל הסיסמאות, כפריט בשם `Vercel — recovery codes`
   - מקום שני שאינו על אותו מכשיר (הדפסה, או כספת נייר)
4. אם החלפת מכשיר — הסר את המכשיר הישן מרשימת ה-2FA

### 3.4 — יצירת `caredesk-staging`

זה שלב נפרד וארוך יותר. **הפירוט המלא:** `docs/governance/ENVIRONMENT-SEPARATION.md`.

בקצרה, הסדר הוא: פרויקט Supabase שני → הרצת כל המיגרציות עליו → פרויקט Vercel שני שמצביע אליו → אימות ש-`db:rls-test` מסרב לרוץ מול ה-ref של הייצור.

**אל תתחיל בזה לפני ש-3.1 עבד.**

---

## שלב 4 — אם התמיכה לא מצליחה לשחזר

תרחיש אמיתי, ולכן כתוב כאן. **אין צורך לבנות את המוצר מחדש** — הקוד ב-GitHub, לא ב-Vercel. מה שאבוד הוא הפרויקט המארח בלבד.

**מה שצריך:**

1. חשבון Vercel חדש
2. חיבור מחדש לאותו ריפו ב-GitHub
3. הזנה מחדש של **כל** משתני הסביבה — הרשימה המלאה ב-`DEPLOYMENT.md`
4. **העברת הדומיין `caredesk-isr.com`:** בחשבון הישן אי אפשר להסירו, אבל **אתה שולט ב-DNS.** מפנים את הרשומות לפרויקט החדש והישן מפסיק לקבל תעבורה.

> **מה שאסור לאבד בדרך:** `WORKSPACE_ENCRYPTION_KEY`. בלעדיו נתוני הלקוחה בייצור חוזרים כ-ciphertext ואינם ניתנים לשחזור בשום אמצעי. ראה `docs/governance/ENCRYPTION-KEY-CUSTODY.md`. **ודא שהוא בידך לפני שאתה נוגע בכל דבר אחר.**

---

## רשימת מעקב

העתק לעצמך וסמן:

```
[ ] 1.1  ניסיתי כניסה דרך GitHub
[ ] 1.2  חיפשתי קודי גיבוי בכל חמשת המקומות
[ ] 2.1  שלחתי פנייה לתמיכה
[ ] 2.2  צירפתי לפחות שתי ראיות בעלות
[ ] 3.1  CRON_SECRET הוגדר + Redeploy בוצע
[ ] 3.2  SUPPORT_FROM_EMAIL הוגדר + Redeploy בוצע
[ ] 3.3  קודי גיבוי חדשים הונפקו ונשמרו בשני מקומות
[ ] 3.4  caredesk-staging נוצר
```

---

## סימוכין

- `docs/governance/NEXT-STEPS.md` §2 — התיאור המקורי של החסימה
- `docs/governance/ENVIRONMENT-SEPARATION.md` — יצירת staging (R0-01)
- `docs/governance/ENCRYPTION-KEY-CUSTODY.md` — משמורת מפתח ההצפנה
- `DEPLOYMENT.md` — רשימת משתני הסביבה המלאה
