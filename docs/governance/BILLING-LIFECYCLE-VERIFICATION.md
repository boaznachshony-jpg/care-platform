# אימות מחזור החיים של החיוב — לפני עלייה לאוויר

> **מה המסמך הזה כן:** מיפוי מלא של מסלול החיוב מתוך הקוד עצמו, עם ציטוט קובץ ושורה, וסקריפט בדיקה ידני שאפשר להריץ מול הייצור.
> **מה המסמך הזה לא:** לא הורצה כאן שום בדיקה. אין רשת ואין vitest בסביבה שבה נכתב המסמך. כל טענה שמסומנת **[קריאה]** נובעת מקריאת קוד בלבד; טענה שמסומנת **[בדיקה קיימת]** מגובה בקובץ טסט שקראתי אך **לא הרצתי**; טענה שמסומנת **[לא ניתן לאמת]** דורשת הרצה מול Cardcom או מול Vercel.

נכתב: 30.8.2026 · היקף: `apps/api/src/routes/billing.ts`, `apps/api/src/billing/`, `apps/api/vercel.json`, `packages/application/src/use-cases/manage-product-billing.ts`, `packages/db/src/billing-repository.ts`, `packages/db/src/activate-product-subscription.ts`, `database/migrations/0014_product_billing.sql`, `apps/web/src/pages/BillingPage.tsx`, `apps/web/src/components/AccountFrozenGate.tsx`.

---

## 0. שתי מכונות מצבים נפרדות — זה שורש רוב הבלבול

בקוד יש **שני** מושגי מצב, והם לא אותו דבר:

| ציר | היכן נשמר | מי מחשב | משפיע על |
| --- | --- | --- | --- |
| `product_subscription.status` | טור בבסיס הנתונים (`0014_product_billing.sql:7-10`) | הריפו והפונקציות ב-SQL | האם הג'וב היומי יגבה; הבאנר "החיוב נכשל" |
| `accessState` (`active` / `grace` / `frozen`) | **לא נשמר בכלל** — נגזר בכל קריאה | `apps/api/src/billing/access-state.ts:42-62` | האם המשתמש מוקפא מחוץ למוצר |

`accessState` **מתעלם לחלוטין מ-`status`**. הוא מסתכל רק על: קיום אמצעי תשלום, `launchDiscountPercent`, `chargingStartsAt` והשעון (`access-state.ts:47-56`). המשמעות המעשית: לקוח ב-`past_due` תמיד מקבל `accessState='active'` — כי יש לו כרטיס שמור. הקפאה קורית רק כשאין כרטיס.

---

## 1. לקוח מחבר כרטיס — היכן נשמר הטוקן, לאן עובר המצב, ומה קורה בכשל

### המסלול התקין

1. **הלקוח לוחץ "חיבור כרטיס מאובטח"** — `apps/web/src/pages/BillingPage.tsx:336-342`, קורא ל-`submit` (שורה 76). הכפתור חסום עד שסומן אישור התנאים ועד ש-`providerConfigured` אמת (שורה 339).
2. **`POST /billing/payment-method/setup`** — `apps/api/src/routes/billing.ts:55-80`. דורש `authenticate` + `requireMfa(env,'billing.manage')` (שורה 33).
3. **יצירת intent לפני הפנייה לספק** — `manage-product-billing.ts:119-129` יוצר שורה ב-`billing_setup_intent` עם `status='created'`.
4. **פנייה ל-Cardcom** — `cardcom-gateway.ts:64-94`, `Operation:'CreateTokenOnly'`, `Amount: 0`, `ReturnValue: intentId` (שורה 71). מוחזרים `LowProfileId` ו-`Url`.
5. **קישור ה-intent + שינוי מצב המנוי** — `manage-product-billing.ts:136` → `billing-repository.ts:150-169`: ה-intent עובר ל-`'pending'`, וה**מנוי כולו עובר ל-`payment_method_pending`** (שורות 162-167). **זה קורה ללא תנאי, לא משנה מה היה המצב הקודם.**
6. **הלקוח מופנה לדף המאובטח של Cardcom** — `BillingPage.tsx:88`.
7. **Cardcom שולח webhook** ל-`POST /billing/webhooks/cardcom` (`routes/billing.ts:98-111`). ה-webhook הוא **טריגר בלבד**: אין בו אימות חתימה, אבל גם אין בו אמון — הוא מוסר רק `LowProfileId` (`schemas/billing.ts:64-68`).
8. **אימות שרת-לשרת** — `manage-product-billing.ts:157` → `cardcom-gateway.ts:96-140`. נבדק `ResponseCode===0`, שה-`Operation` היא `CreateTokenOnly`/`ChargeAndCreateToken`, ושחזרו טוקן, תוקף תקין ו-4 ספרות אחרונות. חסר אחד מהם → `INVALID_RESULT_RESPONSE` והכל נופל.
9. **הצפנת הטוקן** — `cardcom-gateway.ts:214-221`: AES-256-GCM, מפתח מ-`CARDCOM_TOKEN_ENCRYPTION_KEY` (32 בתים, נאכף ב-`cardcom-gateway.ts:61`), עם `providerSetupId` כ-AAD. התוצאה: `nonce.tag.ciphertext` ב-base64url.
10. **שמירה** — `billing-repository.ts:197-219`. הטוקן המוצפן נשמר ב-`product_subscription.sealed_payment_token`; 4 ספרות ב-`card_last4`; **מספר הכרטיס וה-CVV לא עוברים דרך השרת בכלל.** אילוץ ב-DB מוודא שכל שדות אמצעי התשלום קיימים יחד או חסרים יחד (`0014:27-31`).
11. **המצב החדש** — `billing-repository.ts:199-200`: `payment_method_ready` אם `charging_starts_at` מוגדר, אחרת חזרה ל-`sponsored`.

**היכן נשמר הטוקן:** `product_subscription.sealed_payment_token`, מוצפן, ברמת tenant, מאחורי RLS כפוי (`0014:64-65`, מדיניות בשורות 71-73). **[קריאה]**

### מה קורה כש-Cardcom מחזירה שגיאה באמצע

| נקודת כשל | הקוד | התוצאה בפועל |
| --- | --- | --- |
| `Create` מחזירה `ResponseCode≠0` | `cardcom-gateway.ts:205-212` | `CardcomGatewayError` → `routes/billing.ts:77-78` מחזיר 502 `BILLING_SETUP_FAILED`. ה-intent נשאר `'created'`, המנוי **לא** זז מ-`payment_method_pending` (הוא עוד לא הגיע לשם). תקין. |
| הלקוח נטש את דף Cardcom / ביטל | אין קוד | Cardcom מפנה ל-`BILLING_FAILURE_URL` → `/billing?setup=failed` → הודעה ב-`BillingPage.tsx:168-172`. **אבל המנוי נשאר תקוע ב-`payment_method_pending` לנצח.** ראו סעיף 5, פער G-1. |
| ה-webhook מגיע אבל האימות מול Cardcom נכשל | `routes/billing.ts:106-110` | מוחזר 502 בכוונה, כדי ש-Cardcom תנסה שוב. **[קריאה]** |
| ה-webhook תקין אבל אין intent תואם | `manage-product-billing.ts:159-161` | `BillingSetupNotFoundError` → 502 → Cardcom תנסה שוב לנצח, וזה לעולם לא יצליח. |
| קריסה בין `createPaymentMethodSetup` ל-`attachProviderSetup` | `manage-product-billing.ts:131-136` | ה-intent נשאר `'created'`. פונקציית החיפוש `find_caredesk_billing_setup_intent` מחזירה רק `'pending'` או `'completed'` (`0014:109-112`) — ולכן ה-webhook **לעולם לא ימצא** את ה-intent. הלקוח הזין כרטיס, קיבל מסך הצלחה, והטוקן לא נשמר. כשל שקט. |
| `failPaymentMethodSetup` | `billing-repository.ts:225-233` | **קוד מת.** אין לו קורא אחד בכל המערכת (חיפוש מלא: מופיע רק בפורט, במימוש, ב-mock ובטסט). intent-ים כושלים פשוט פוקעים אחרי שעתיים (`0014:44`). |

**מסך ההצלחה מטעה:** אחרי חזרה מ-Cardcom מוצגת ההודעה "הפרטים נשלחו לאימות מאובטח" (`BillingPage.tsx:163-167`, `he.json → billing.setupReturned`). הדף טוען את המנוי פעם אחת בלבד (`BillingPage.tsx:66-68`) ואין polling. אם ה-webhook טרם הגיע — הלקוח רואה הודעת הצלחה **ומתחתיה טופס ריק לחיבור כרטיס**. הניסוח נבחר בזהירות ("יופיע לאחר אישור Cardcom") אבל החוויה מבלבלת. **[קריאה]**

---

## 2. הג'וב היומי ב-04:17 UTC

**הגדרה:** `apps/api/vercel.json:7` — `{"path": "/billing/jobs/collect", "schedule": "17 4 * * *"}`. כל הבקשות מנותבות ל-`/api/index` (שורה 6) ומשם ל-Fastify (`apps/api/api/index.js`).

**אימות:** `routes/billing.ts:113-117` — משווה `Authorization` ל-`Bearer ${CRON_SECRET}` בהשוואה עמידת-תזמון (`secureEqual`, שורות 18-22). אם `CRON_SECRET` ריק — כל קריאה נדחית ב-401. **[בדיקה קיימת]** `routes/billing.test.ts:187,197`.

### מה בדיוק נבחר לגבייה

`claim_caredesk_product_billing_charges` (`0014:118-182`). כל התנאים ב-`0014:144-152` חייבים להתקיים:

- `status in ('payment_method_ready','active','past_due')` — **`sponsored`, `payment_method_pending` ו-`cancelled` לא ייגבו לעולם**
- `launch_discount_percent = 0` — **כל הנחה חלקית (למשל 20%) מוציאה את הלקוח מגבייה לחלוטין**
- `charging_starts_at` קיים ו-`<= היום`
- `next_charge_on` קיים ו-`<= היום`
- קיים `sealed_payment_token`, `billing_name`, `billing_email`

מיון לפי `next_charge_on`, `limit greatest(1, least(p_limit,100))`, `for update skip locked` (שורות 153-155). ה-use case קורא עם ברירת מחדל **25** (`manage-product-billing.ts:200`), והנתיב לא מעביר פרמטר (`routes/billing.ts:119`) — **תקרה של 25 לקוחות ליום.**

### מה נגבה

`chargeMonthly` (`cardcom-gateway.ts:142-189`): סכום = `amount_agorot/100`, טוקן מפוענח לפי AAD, `ExternalUniqTranId` = מזהה החיוב, ומסמך `TaxInvoiceAndReceipt` שנשלח במייל ללקוח (`IsSendByEmail: true`, שורה 166). timeout של 15 שניות לכל קריאה (`cardcom-gateway.ts:196`).

⚠️ **הסכום שנגבה הוא `d.price_agorot` — המחיר המלא** (`0014:160`), לא `effectivePriceAgorot`. כרגע זה לא גורם לחיוב-יתר רק משום שהנחה>0 מוציאה מגבייה מלכתחילה. אם מישהו ישנה את תנאי ההנחה — הלקוח יחויב במחיר מלא. **[קריאה]**

### מה מתעדכן

- **הצלחה:** `complete_caredesk_product_billing_charge` (`0014:184-209`) — החיוב ל-`succeeded`, המנוי ל-`active`, ו-`next_charge_on` מתקדם בחודש. עדכון המנוי מותנה בכך שעדכון החיוב באמת תפס (`0014:203`).
- **כשל:** `fail_caredesk_product_billing_charge` (`0014:211-233`) — החיוב ל-`failed` עם קוד ספק חתוך ל-120 תווים, המנוי ל-`past_due`, **`next_charge_on` לא זז** — כדי שאותה תקופה תנוסה שוב.
- **תיעוד:** רשומת audit `billing.charge_succeeded` / `billing.charge_failed` עם `actorId: null` ו-`sensitivity:'financial_sensitive'` (`manage-product-billing.ts:234-262`). **אין בה נתוני כרטיס** — רק קוד ספק (`chargeFailureCode`, שורות 189-195). **[בדיקה קיימת]** `routes/billing.test.ts:342-345` מוודא שהטוקן ו-4 הספרות לא מופיעים ב-audit.

### אידמפוטנטיות — כן, ובאופן איתן

השורה ב-`product_billing_charge` היא נעילת האידמפוטנטיות: `unique (tenant_id, billing_period)` (`0014:61`). ה-`on conflict do update` מבוצע **רק** אם החיוב `failed`, או `processing` ותקוע יותר מ-30 דקות, **וגם** `attempts < 3` (`0014:163-173`). אם התנאי לא מתקיים — אין `returning`, השורה לא נתפסת, ולא מתבצע חיוב.

הרצה שנייה באותו יום אחרי הצלחה: `next_charge_on` כבר התקדם + החיוב `succeeded` → 0 שורות. **[בדיקה קיימת]** `routes/billing.test.ts:347-357` (`{processed: 0}`).

### קריסה באמצע אצווה

| תרחיש | מה קורה |
| --- | --- |
| קריסה לפני קריאת Cardcom | החיוב תקוע `processing`; ייתפס שוב אחרי 30 דקות — אבל ה-cron רץ פעם ביום, אז **בפועל למחרת**. |
| קריסה **אחרי** ש-Cardcom חייבה ולפני `markChargeSucceeded` | החיוב תקוע `processing`, המנוי לא זז. למחרת החיוב ייתפס שוב **ו-Cardcom תיקרא שוב עם אותו `ExternalUniqTranId`**. ההגנה היחידה היא הדה-דופליקציה של Cardcom (`ExternalUniqUniqTranIdResponse: true`, `cardcom-gateway.ts:155`). **[לא ניתן לאמת]** — לא בדקתי מול Cardcom האם היא מחזירה את העסקה המקורית עם `ResponseCode=0` או שגיאה. אם היא מחזירה שגיאה — הלקוח שחויב יסומן `past_due` בטעות. |
| החלק שכבר עובד באצווה | הלולאה ב-`manage-product-billing.ts:205-264` מסמנת כל חיוב מיד; מה שהספיק — נשמר. אין טרנזקציה גורפת. |
| timeout של פונקציית Vercel | ⚠️ **אין `maxDuration` בשום מקום בפרויקט.** 25 חיובים סדרתיים × עד 15 שניות = עד 375 שניות. ברירת המחדל של Vercel נמוכה בהרבה. **[לא ניתן לאמת]** — צריך לראות ריצה אמיתית בלוגים. |

---

## 3. חיוב נכשל — מה הלקוח באמת רואה

1. `past_due` נקבע? **כן** — `0014:229-231`. **[בדיקה קיימת]** `routes/billing.test.ts:321-345`, `manage-product-billing.test.ts:115-137`.
2. הבאנר מוצג? **כן, בתנאים** — `AccountFrozenGate.tsx:87,91-95`, הטקסט: "החיוב האחרון של המנוי נכשל. יש לעדכן את אמצעי התשלום…". בדף `/billing` עצמו מוצגת אזהרה במקום ההודעה הירוקה (`BillingPage.tsx:210-224`) עם כפתור `reconnectCard`.
   **המגבלה:** מצב החיוב נטען **פעם אחת לכל טעינת SPA** ונשמר במשתנה מודול (`AccountFrozenGate.tsx:13-28`). לקוח עם טאב פתוח לא יראה שינוי עד רענון. בנוסף, במקרה של שגיאת רשת הרכיב **נכשל פתוח** בכוונה (שורות 53-55) — כלומר לא מציג כלום.
3. יש retry? **כן: עד 3 ניסיונות, במרווח של 24 שעות** (התדירות היחידה היא ה-cron היומי), כלומר בערך 3 ימים. אחרי הניסיון השלישי `attempts=3`, התנאי `attempts < 3` (`0014:173`) לא מתקיים לעולם — **החיוב מת סופית ו-`next_charge_on` נשאר תקוע באותה תקופה. הלקוח לא יחויב יותר לעולם.** **[בדיקה קיימת]** `routes/billing.test.ts:359-371`.
4. **האם לקוח מוקפא בלי שנאמר לו?** **כן, וזה הפער החמור ביותר.**
   - אין בכל קוד החיוב שום שליחת מייל/SMS. חיפוש מלא של `charge_failed`/`past_due` בכל הריפו מחזיר רק audit, UI וטסטים. **החיוב היחיד שהלקוח מקבל בדואר הוא החשבונית של Cardcom כשהחיוב מצליח.**
   - ההודעה על כשל היא **אך ורק באנר בתוך האפליקציה**. לקוח שלא נכנס לאפליקציה במשך שבוע — לא יודע דבר.
   - `past_due` לבדו לא מקפיא (יש כרטיס ⇒ `accessState='active'`), אז במקרה הזה הוא לא ננעל — הוא פשוט מקבל שירות חינם. אבל בתרחיש הביטול (סעיף 4) ההקפאה **מיידית**, בלי שום התראה מוקדמת.

---

## 4. מסלול ההקפאה

**מה מקפיא:** רק `accessState==='frozen'` (`AccountFrozenGate.tsx:63-78`). התנאי (`access-state.ts:47-62`), לפי הסדר:

```
יש אמצעי תשלום            → active
הנחה = 100%               → active
charging_starts_at = null → active
עוד לא הגיע התאריך        → active
תאריך לא פריק             → active   (fail-open מכוון, שורה 55)
עברו פחות מ-GRACE_DAYS    → grace    (ברירת מחדל 7 ימים, env.ts:63)
אחרת                      → frozen
```

**מי בפועל יכול להגיע לשם?** הפעלת חיוב בתשלום (`activate-product-subscription.ts:46-58`) **דורשת שכבר יש טוקן שמור** (`and sealed_payment_token is not null`). לכן `chargingStartsAt` לא יכול להיות מוגדר בלי כרטיס — **אלא אם הכרטיס הוסר**. הדרך היחידה להסיר כרטיס היא **ביטול המנוי** (`billing-repository.ts:238-243`).

🔴 **התוצאה: לקוח שמבטל מנוי מוקפא מיידית, בלי אף יום חסד.** חלון החסד מעוגן ב-`charging_starts_at` (`access-state.ts:54`) — תאריך שכבר עבר מזמן. `elapsedDays` יהיה למשל 90 > 7 ⇒ `frozen` באותה שנייה. הדיאלוג שהלקוח אישר אומר רק "לבטל את המנוי, לעצור חיובים עתידיים ולהסיר את אסימון התשלום השמור?" — **הוא לא אומר שהוא ננעל מחוץ למוצר.** **[קריאה]**

**האם אפשר להשתחרר בעצמך על ידי הוספת כרטיס?** **כן — בכניסה. לא — בחיוב.**
`/billing` אף פעם לא ננעל (`AccountFrozenGate.tsx:61,63`), כך שהלקוח יכול לחבר כרטיס: → `payment_method_pending` → webhook → `payment_method_ready`, ו-`accessState` חוזר ל-`active`. **אבל** `cancel` איפס את `next_charge_on` ל-NULL (`billing-repository.ts:239`), ו-`completePaymentMethodSetup` **לא מחזיר אותו** (`billing-repository.ts:198-206`). התנאי `next_charge_on is not null` (`0014:148`) לא יתקיים לעולם ⇒ **הלקוח משתמש במוצר בחינם לצמיתות.**

⚠️ הערה נוספת: אם ישונה `SENSITIVE_OPERATION_MFA_MODE` ל-`enforce` (`env.ts:12`, `plugins/mfa.ts:21-23`), לקוח מוקפא בלי AAL2 יקבל 403 בניסיון לחבר כרטיס, וה-UI יציג לו רק "לא ניתן לטעון כרגע את פרטי המנוי" (`BillingPage.tsx:89-92,174-180`). **נעילה ללא מוצא.**

---

## 5. טבלת המצבים — נגזרת מהקוד

### ציר א׳: `product_subscription.status`

| מצב | נכנסים אליו מ… | הקוד שמכניס | יוצאים ממנו אל… | נגבה? |
| --- | --- | --- | --- | --- |
| `sponsored` | יצירה ראשונה של tenant; או השלמת כרטיס כאשר `charging_starts_at` ריק | `billing-repository.ts:106`; `:199` | `payment_method_pending` (התחלת חיבור כרטיס), `payment_method_ready` (פקודת ההפעלה), `cancelled` | ❌ |
| `payment_method_pending` | **מכל מצב שהוא**, ללא תנאי, ברגע שנוצר session ב-Cardcom | `billing-repository.ts:162-167` | `payment_method_ready` / `sponsored` — **רק דרך webhook מוצלח**; `cancelled` | ❌ 🔴 |
| `payment_method_ready` | השלמת כרטיס כש-`charging_starts_at` קיים; פקודת ההפעלה של האופרטור | `billing-repository.ts:199`; `activate-product-subscription.ts:47` | `active` (גבייה מוצלחת), `past_due` (כשל), `payment_method_pending`, `cancelled` | ✅ |
| `active` | גבייה חודשית מוצלחת | `0014:204-205` | `past_due`, `payment_method_pending`, `cancelled` | ✅ |
| `past_due` | גבייה חודשית כושלת | `0014:229-231` | `active` (ניסיון חוזר מוצלח), `payment_method_pending`, `cancelled`. **אחרי 3 ניסיונות: אין יציאה אוטומטית** | ✅ עד 3 ניסיונות |
| `cancelled` | ביטול על ידי הבעלים | `billing-repository.ts:238` | `payment_method_pending` → `payment_method_ready` (הוספת כרטיס מחדש) — **אך `next_charge_on` נשאר NULL** | ❌ |

### ציר ב׳: `accessState` (נגזר, לא נשמר)

| מצב | נכנסים | יוצאים | השפעה על המשתמש |
| --- | --- | --- | --- |
| `active` | יש כרטיס / הנחה 100% / אין `charging_starts_at` / התאריך בעתיד / תאריך פגום | ברגע שהכרטיס מוסר וכל התנאים נופלים | שימוש מלא |
| `grace` | אין כרטיס, ההנחה 0, עברו 0..GRACE-1 ימים מ-`charging_starts_at` | חיבור כרטיס → `active`; חלוף הזמן → `frozen` | באנר צהוב, שימוש מלא |
| `frozen` | אין כרטיס וחלפו ≥ GRACE ימים מ-`charging_starts_at` | חיבור כרטיס בלבד | **חסימה מלאה** של כל המסכים חוץ מ-`/billing` |

**צירוף שאי אפשר להגיע אליו בפועל:** `past_due` + `frozen`. אי-אפשר, כי `past_due` מחייב כרטיס שמור וכרטיס שמור מחייב `active`.

---

## 6. סקריפט בדיקה ידני מול הייצור

הכן מראש: גישת SQL לבסיס הנתונים (`DATABASE_ADMIN_URL`), חשבון בדיקה ייעודי (**לא** של לקוח אמיתי), וכרטיס אמיתי + כרטיס שנועד להידחות מסביבת Cardcom. **שמור את `tenant_id` של חשבון הבדיקה בצד — כל שאילתה משתמשת בו.**

### שלב 0 — ה-cron בכלל רץ?

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<api-host>/billing/jobs/collect
curl -i https://<api-host>/billing/jobs/collect          # בלי כותרת
```

**עובר אם:** הראשון מחזיר `200` עם `{"processed":N,"succeeded":N,"failed":N}`. השני מחזיר `401 UNAUTHENTICATED`.
**נכשל אם:** הראשון מחזיר 401 (הסוד לא זהה בין Vercel ל-env), או 503 `BILLING_COLLECTION_UNAVAILABLE` (הספק לא מוגדר).
בנוסף — ב-Vercel → Project → Cron Jobs, ודא שהג'וב **מופיע ורשום כפעיל**, ולמחרת בבוקר בדוק ב-Logs שהייתה קריאה סביב 04:17 UTC. **[לא ניתן לאמת מכאן]**

### שלב 1 — חיבור כרטיס (מסלול תקין)

1. היכנס לחשבון הבדיקה → `/billing`. **עובר אם** מוצג מחיר 39 ₪ כולל מע״מ וכפתור "חיבור כרטיס מאובטח" **פעיל**. אם מוצג "החיבור לסליקה נמצא בהשלמת אימות בית העסק" — `BILLING_PROVIDER` אינו `cardcom` ואין טעם להמשיך.
2. מלא שם ודוא״ל, סמן את התנאים, לחץ. **עובר אם** אתה מגיע לדף המאובטח של Cardcom.
3. **לפני** שאתה מזין כרטיס, בדוק ב-DB:

```sql
select status, provider_setup_id from billing_setup_intent where tenant_id = :t order by created_at desc limit 1;
select status, next_charge_on, charging_starts_at, card_last4 from product_subscription where tenant_id = :t;
```

**עובר אם:** ה-intent `pending` עם `provider_setup_id`, והמנוי `payment_method_pending`.
🔴 **אם ה-intent נשאר `created` — עצור. ה-webhook לעולם לא ימצא אותו** (`0014:109-112`).

4. הזן כרטיס תקין ואשר. **עובר אם** חזרת ל-`/billing?setup=success`.
5. המתן 30 שניות, **רענן** ובדוק:

```sql
select status, card_last4, card_expiry_month, card_expiry_year,
       sealed_payment_token is not null as has_token,
       length(sealed_payment_token) as token_len, next_charge_on
  from product_subscription where tenant_id = :t;
```

**עובר אם:** `status='sponsored'` או `'payment_method_ready'`, `has_token=true`, `card_last4` תואם לכרטיס, ו-`sealed_payment_token` בפורמט `xxx.yyy.zzz` (שלושה חלקים מופרדים בנקודה) — **ולא** מספר כרטיס גלוי.
**עובר גם אם:** במסך מוצג "כרטיס המסתיים ב-####" עם התוקף.
**נכשל אם:** אחרי דקה עדיין `payment_method_pending` — ה-webhook לא הגיע. בדוק ב-Vercel Logs `Cardcom webhook verification failed` וב-Cardcom את היסטוריית ההתראות.

6. בדוק שהתיעוד נוצר: `select action, occurred_at from audit_event where tenant_id=:t and action like 'billing%' order by occurred_at desc limit 5;` → צפוי `billing.payment_method.setup_started` ואחריו `billing.payment_method.ready`.

### שלב 2 — הפעלת חיוב בתשלום

```bash
DATABASE_ADMIN_URL=... BILLING_ACTIVATION_TENANT_ID=<tenant> \
BILLING_ACTIVATION_START_DATE=<היום, YYYY-MM-DD> \
BILLING_ACTIVATION_CONFIRMATION=I_HAVE_NOTIFIED_THE_CUSTOMER_AND_APPROVE_MONTHLY_CHARGING \
node packages/db/dist/activate-product-subscription.js
```

**עובר אם:** `status='payment_method_ready'`, `launch_discount_percent=0`, `charging_starts_at = next_charge_on = היום`.
**עובר גם אם:** ב-`/billing` מוצג "המנוי החודשי פעיל" עם התאריך והסכום הנכונים.

### שלב 3 — גבייה מוצלחת

הרץ את ה-cron ידנית (curl משלב 0).
**עובר אם:** התשובה `{"processed":1,"succeeded":1,"failed":0}`, ובנוסף:

```sql
select status, attempts, provider_transaction_id, failure_code
  from product_billing_charge where tenant_id=:t order by created_at desc limit 1;
select status, next_charge_on from product_subscription where tenant_id=:t;
```

→ החיוב `succeeded` עם `provider_transaction_id`, המנוי `active`, `next_charge_on` = חודש קדימה.
**עובר גם אם:** החשבונית/קבלה הגיעה למייל שהוזן, ובממשק Cardcom מופיעה עסקה בסכום הנכון.

### שלב 4 — אידמפוטנטיות

הרץ את אותו curl **פעם שנייה מיד**.
**עובר אם:** `{"processed":0,"succeeded":0,"failed":0}` ו**אין עסקה שנייה ב-Cardcom**. זו הבדיקה שמונעת חיוב כפול. **אם נוצרה עסקה שנייה — זה חוסם שחרור.**

### שלב 5 — 🔴 כרטיס שנכשל (הבדיקה שהכי חשובה)

1. `update product_subscription set next_charge_on = current_date where tenant_id = :t;`
2. החלף לכרטיס שנדחה: עבור דרך "עדכון אמצעי התשלום" והזן כרטיס דחייה של Cardcom.
   **עובר אם:** אחרי ה-webhook `card_last4` השתנה ו-`status='payment_method_ready'`.
   🔴 **בדוק במפורש ש-`next_charge_on` עדיין = היום ולא NULL.** אם הוא NULL — אין מה לבדוק, המערכת לא תגבה.
3. הרץ את ה-cron. **עובר אם:** `{"processed":1,"succeeded":0,"failed":1}`.
4.
```sql
select status, attempts, failure_code from product_billing_charge where tenant_id=:t order by created_at desc limit 1;
select status, next_charge_on from product_subscription where tenant_id=:t;
select action, change_summary from audit_event where tenant_id=:t and action='billing.charge_failed' order by occurred_at desc limit 1;
```
**עובר אם:** החיוב `failed` עם `attempts=1` וקוד ספק ב-`failure_code`; המנוי **`past_due`**; `next_charge_on` **לא זז**; יש רשומת audit עם קוד הספק **ובלי** 4 ספרות הכרטיס ובלי הטוקן.
5. **החוויה של הלקוח** — צא והיכנס מחדש (חובה: המצב נשמר במטמון לכל טעינת SPA):
   - בדשבורד: **באנר אדום** "החיוב האחרון של המנוי נכשל…" עם קישור.
   - ב-`/billing`: כותרת "החיוב האחרון נכשל" **במקום** ההודעה הירוקה, וכפתור "עדכון אמצעי התשלום".
   - **הלקוח עדיין יכול להשתמש במוצר** — זו התנהגות מכוונת (`AccountFrozenGate.tsx:80-87`).
   🔴 **עובר רק אם ראית את שני הבאנרים בפועל.** אם המנוי `past_due` ואין באנר — זה חוסם שחרור: לקוח שנכשל ולא נאמר לו הוא התוצאה הגרועה ביותר.
6. **תעד במפורש**: לא נשלח שום מייל ולא שום SMS. ודא זאת — בדוק את תיבת הדוא״ל של הלקוח וודא שאין כלום. זו לא תקלה שתתגלה, זו החלטת עיצוב קיימת (סעיף 7, G-2).
7. הרץ את ה-cron עוד פעמיים. **עובר אם:** `attempts` מגיע ל-3, ובהרצה הרביעית `{"processed":0}`. 🔴 מכאן ואילך **הלקוח לא יחויב לעולם והמנוי נשאר `past_due` לצמיתות.**
8. **התאוששות:** חבר כרטיס תקין דרך "עדכון אמצעי התשלום", הרץ cron. **צפוי לפי הקוד: `{"processed":0}`** — כי `attempts=3` כבר מיצה את התקופה. כדי לגבות בפועל צריך התערבות ידנית:
```sql
-- תיקון ידני נדרש אחרי מיצוי 3 ניסיונות:
delete from product_billing_charge where tenant_id=:t and billing_period=<התקופה>;
update product_subscription set next_charge_on = current_date where tenant_id=:t;
```

### שלב 6 — נטישת חיבור כרטיס (הפער השקט)

1. ב-`/billing` לחץ "עדכון אמצעי התשלום", והגע לדף Cardcom — **וסגור את הטאב**.
2. `select status, next_charge_on, card_last4 from product_subscription where tenant_id=:t;`
   🔴 **צפוי לפי הקוד: `payment_method_pending`, הכרטיס הישן עדיין שמור.**
3. הרץ cron. **צפוי: `{"processed":0}`** — כי `payment_method_pending` לא ברשימת המצבים הנגבים (`0014:144`).
4. פתח את `/billing`. **צפוי: הודעה ירוקה "המנוי החודשי פעיל" עם תאריך החיוב הבא** — כלומר המערכת אומרת ללקוח שהכל תקין בזמן שהוא כבר לא מחויב.
   **אין שום מנגנון אוטומטי שמחזיר אותו.** תיקון: `update product_subscription set status='payment_method_ready' where tenant_id=:t;`

### שלב 7 — ביטול והקפאה

1. ב-`/billing` לחץ "ביטול המנוי והסרת אמצעי התשלום" ואשר.
2. `select status, next_charge_on, card_last4, charging_starts_at from product_subscription where tenant_id=:t;`
   **עובר אם:** `cancelled`, `next_charge_on=NULL`, `card_last4=NULL`, `sealed_payment_token=NULL`.
3. נווט ל-`/app` (ייתכן שיידרש רענון).
   🔴 **צפוי: מסך "החשבון מוקפא" מיידית, בלי אף יום חסד** — כי חלון החסד נמדד מ-`charging_starts_at` שכבר עבר. אם `charging_starts_at` הוגדר להיום ממש, יוצגו 7 ימי חסד; אם הוגדר לפני יותר משבוע — הקפאה מיידית. **בדוק את שני המקרים.**
4. חבר כרטיס מחדש מ-`/billing` (הדף היחיד שלא ננעל).
   **עובר אם:** ההקפאה משתחררת אחרי רענון והמצב `payment_method_ready`.
   🔴 **בדוק `next_charge_on` — צפוי NULL.** אם כן, הרץ cron: `{"processed":0}`. **הלקוח משוחרר אבל לא ישולם עליו לעולם.** תיקון ידני: `update product_subscription set next_charge_on = current_date where tenant_id=:t;`

### שלב 8 — ניקוי

מחק את שורות `product_billing_charge`, `billing_setup_intent` ו-`product_subscription` של חשבון הבדיקה, וזכה ב-Cardcom את העסקאות האמיתיות שנוצרו בשלב 3.

---

## 7. פערים — מה הקוד לא מטפל בו

| # | פער | חומרה | היכן | מה קורה בפועל |
| --- | --- | --- | --- | --- |
| **G-1** | `payment_method_pending` היא מלכודת ללא יציאה אוטומטית | 🔴 חוסם | `billing-repository.ts:162-167` מול `0014:144` | כל לקוח שמתחיל חיבור כרטיס ונוטש — מפסיק להיות מחויב לצמיתות, בזמן שה-UI מציג לו "המנוי החודשי פעיל". כשל שקט לחלוטין: אין audit, אין לוג, אין התראה. |
| **G-2** | אין שום ערוץ התראה מחוץ לאפליקציה | 🔴 חוסם | חיפוש מלא — אין מייל בכל מסלול החיוב | כשל חיוב, ימי חסד והקפאה מדווחים **רק** בבאנר בתוך המוצר. לקוח שלא נכנס לא יודע. ההקפאה מגיעה בלי אזהרה מוקדמת שהוא ראה. |
| **G-3** | ביטול ⇒ הקפאה מיידית בלי חסד, והדיאלוג לא מזהיר | 🔴 חוסם | `access-state.ts:54-62` + `billing-repository.ts:238-243` + `he.json → billing.cancelConfirm` | הלקוח מאשר "לעצור חיובים עתידיים" ומקבל נעילה מהמוצר באותה שנייה. חלון החסד מעוגן בתאריך היסטורי ולכן ריק. |
| **G-4** | `next_charge_on` לא משוחזר אחרי ביטול | 🔴 גבוה | `billing-repository.ts:239` מול `:198-206` | ביטול + חיבור כרטיס מחדש = שירות חינם לצמיתות. אין קוד שמחזיר את `next_charge_on`. |
| **G-5** | מיצוי 3 ניסיונות = מבוי סתום | 🟠 גבוה | `0014:173` | אחרי 3 כשלים המנוי נשאר `past_due` לנצח, לא נגבה יותר, וגם תיקון הכרטיס לא עוזר. נדרשת התערבות SQL ידנית. אין התראה שזה קרה. |
| **G-6** | אין `maxDuration`, ותקרת 25 סדרתיים | 🟠 גבוה | `vercel.json` (אין), `manage-product-billing.ts:200`, `cardcom-gateway.ts:196` | 25 חיובים × עד 15ש׳ עלולים לחרוג מ-timeout של הפונקציה. חיובים שנקטעו נשארים `processing` ויתפסו שוב רק למחרת. מעל 25 לקוחות נדרשת יותר מהרצה אחת ליום. |
| **G-7** | חלון חיוב כפול בין Cardcom ל-`markChargeSucceeded` | 🟠 גבוה **[לא ניתן לאמת]** | `manage-product-billing.ts:224-232` | אם התהליך מת בין השניים, החיוב יבוצע שוב למחרת. ההגנה היחידה היא `ExternalUniqTranId` בצד Cardcom — התנהגותה לא נבדקה. |
| **G-8** | קריסה בין `Create` ל-`attachProviderSetup` = intent יתום | 🟠 בינוני | `manage-product-billing.ts:131-136` מול `0014:109-112` | ה-intent נשאר `created`, ה-webhook לא ימצא אותו, והטוקן לא יישמר — אף שהלקוח ראה מסך הצלחה. |
| **G-9** | סכום החיוב מתעלם מההנחה | 🟠 בינוני | `0014:160` (`d.price_agorot`) מול `manage-product-billing.ts:73` | כרגע מוסווה על ידי התנאי `launch_discount_percent = 0`. כל לקוח עם הנחה חלקית (1-99%) פשוט **לא נגבה כלל**, בשקט. |
| **G-10** | `failPaymentMethodSetup` הוא קוד מת | 🟡 נמוך | `billing-repository.ts:225-233` | אין קורא. intent-ים כושלים נשארים `pending` עד פקיעה אחרי שעתיים. |
| **G-11** | מצב החיוב במטמון לכל טעינת SPA | 🟡 נמוך | `AccountFrozenGate.tsx:13-28` | לקוח עם טאב פתוח לא יראה שינוי מצב עד רענון. |
| **G-12** | הודעת שגיאה גורפת ב-`/billing` | 🟡 נמוך | `BillingPage.tsx:89-92,174-180` | כל כשל (כולל 403 של MFA ו-503 של הספק) מוצג כ"לא ניתן לטעון את פרטי המנוי". אם `SENSITIVE_OPERATION_MFA_MODE` יועבר ל-`enforce`, לקוח מוקפא ללא AAL2 ננעל בלי מוצא ובלי הסבר. |
| **G-13** | ה-webhook לא מאומת חתימתית | 🟢 מקובל | `routes/billing.ts:98-111` | מתוכנן: ה-webhook הוא טריגר בלבד וכל האמת נשאבת מ-Cardcom בקריאה נפרדת. תוקף יכול לגרום לקריאות `GetLpResult` מיותרות (הצפת בקשות) — אין rate-limit על הנתיב. |

---

## 8. מה כן מאומת היטב

- הצפנת הטוקן (AES-256-GCM עם AAD), דחיית טוקן שעבר שינוי — `cardcom-gateway.test.ts:275`.
- דחיית מטא-דאטה חלקית של כרטיס במקום המצאת ערכים — `cardcom-gateway.test.ts:334`.
- אידמפוטנטיות של הרצה חוזרת ותקרת 3 הניסיונות — `routes/billing.test.ts:347,359`.
- `past_due` בלי קידום `next_charge_on`, ובלי דליפת נתוני כרטיס ל-audit — `routes/billing.test.ts:321-345`.
- כל גבולות חלון החסד, כולל יום 6/יום 7 ו-fail-open על תאריך פגום — `access-state.test.ts:50-84`.
- דחיית cron בלי סוד / בלי כותרת — `routes/billing.test.ts:187,197`.
- RLS כפוי על שלוש טבלאות החיוב + `security definer` צר במקום `BYPASSRLS` — `0014:64-79,235-242`.

**כל אלה נקראו, אף אחד מהם לא הורץ בסביבה הזו.**

---

## 9. המלצה

**לא לשחרר לפני ש-G-1, G-2 ו-G-3 נסגרים.** (עדכון 30.8.2026: G-1, G-3, G-4 ו-G-5 נסגרו בקוד — ראו סעיף 10. G-2 עדיין פתוח וממשיך לחסום.) שלושתם נוגעים באותו כשל: המערכת יכולה להשאיר לקוח במצב שגוי בלי לומר לו דבר — או משלם-שלא-משלם בלי לדעת (G-1), או נכשל בלי שנודע לו (G-2), או נעול מחוץ למוצר ברגע אחד בלי אזהרה (G-3). G-4 ו-G-5 הם דליפת הכנסות שקטה שאפשר לחיות איתה שבועות ספורים עם ניטור ידני, אבל לא לאורך זמן.

**ניטור מינימלי שחייב להיות ביום השחרור**, גם אם התיקונים יידחו — שאילתה יומית:

```sql
select status, count(*) from product_subscription group by status;
select tenant_id, billing_period, attempts, failure_code
  from product_billing_charge where status <> 'succeeded';
select tenant_id, updated_at from product_subscription
 where status = 'payment_method_pending' and updated_at < now() - interval '1 day';
```

השורה השלישית היא הגלאי ל-G-1. כל שורה שמופיעה בה היא לקוח שהמערכת שכחה לגבות ממנו.

---

## 10. מה נסגר בפועל (30.8.2026) — G-1, G-3, G-4, G-5

> **סטטוס אימות:** כל השינויים למטה עברו `tsc --noEmit` בכל החבילות המושפעות, prettier ו-eslint. **vitest לא הורץ** בסביבה שבה נכתב הסעיף הזה, וגם **לא הורצה שום מיגרציה מול Postgres** — אין מנוע בסיס נתונים בסביבה. רשימת קבצי הטסט שחייבים לרוץ על Windows נמצאת בסוף הסעיף.

**מיגרציה חדשה:** `database/migrations/0036_billing_lifecycle_recovery.sql` — אדיטיבית בלבד. אין `drop`, אין `delete`, ואין backfill שכותב על ערך קיים. עברה את `findDestructiveMigrationStatements` ללא ממצאים. חתימת `claim_caredesk_product_billing_charges` ועמודות ה-`returns table` שלה זהות בתו לאלה שב-0014, ולכן `create or replace` תופס בלי לשבור פריסה מתגלגלת.

עמודות שנוספו:

| טבלה | עמודה | תפקיד |
| --- | --- | --- |
| `product_subscription` | `pending_setup_intent_id`, `pending_setup_started_at` | רישום ה-checkout שבתהליך — **בנפרד** ממצב החיוב (G-1) |
| `product_subscription` | `access_grace_starts_at` | עוגן שני לחלון החסד, נקבע בביטול (G-3) |
| `product_subscription` | `payment_method_updated_at` | מתי נשמר אמצעי תשלום מאומת (G-5) |
| `product_billing_charge` | `attempt_cycle` | מחזור של עד שלושה ניסיונות; מוגבל ל-10 |
| `product_billing_charge` | `payment_method_refreshed_at` | איזה כרטיס המחזור הנוכחי מנסה |

### G-1 — נטישת checkout כבר לא עוצרת חיוב

`packages/db/src/billing-repository.ts` → `attachProviderSetup`. ה-`update` שקבע `status = 'payment_method_pending'` ללא תנאי הוחלף ב-`case when sealed_payment_token is null then 'payment_method_pending' else status end`, וה-intent שבתהליך נרשם ב-`pending_setup_intent_id` / `pending_setup_started_at`. לקוח עם כרטיס תקין נשאר `payment_method_ready`/`active`/`past_due` — כלומר נשאר ברשימת הנגבים של `0014:144` — גם אם סגר את הטאב. לקוח **בלי** כרטיס עדיין עובר ל-`payment_method_pending`, כי זה המצב הנכון עבורו.

השאילתה השלישית בסעיף 9 (הגלאי ל-G-1) עדיין שימושית, אבל צריכה לרוץ על העמודה החדשה:

```sql
select tenant_id, pending_setup_started_at from product_subscription
 where pending_setup_started_at is not null
   and pending_setup_started_at < now() - interval '1 day';
```

### G-3 — ביטול כבר לא נעילה מיידית, והדיאלוג אומר את זה

שני שינויים:

1. `billing-repository.ts` → `cancel` קובע `access_grace_starts_at` לתאריך הביטול, ו-`apps/api/src/billing/access-state.ts` בוחר את **המאוחר** מבין `chargingStartsAt` ל-`accessGraceStartsAt` כעוגן. תאריך ביטול לא-פריק **נכשל פתוח** (`active`) ולא נופל חזרה לעוגן הישן שכבר מוצה. לקוח שמבטל מקבל מעכשיו `GRACE_DAYS` ימים מלאים במקום הקפאה באותה שנייה.
2. `packages/i18n/src/resources/{he,en}.json` → `billing.cancelConfirm` נוסח מחדש ואומר במפורש שהגישה תיחסם בעוד `{{days}}` ימים ושהנתונים נשמרים. `BillingPage.tsx` מעביר את `plan.graceDays`, שדה חדש ב-`BillingPlanResponse` שהנתיב ממלא מ-`env.BILLING_GRACE_DAYS` — ה-UI צריך את אורך החלון **לפני** שהחלון נפתח.

### G-4 — הוספת כרטיס אחרי ביטול מחזירה תאריך חיוב

`billing-repository.ts` → `completePaymentMethodSetup` מוסיף `next_charge_on = greatest(charging_starts_at, current_date)` — **רק** כאשר `charging_starts_at` קיים ו-`next_charge_on` ריק. תאריך חיוב קיים לא זז. באותה שאילתה מתאפסים `access_grace_starts_at` ו-`pending_setup_*`, ונקבע `payment_method_updated_at`.

הערה מכוונת: לקוח שביטל ב-5 בחודש וחיבר כרטיס ב-20 בו מחויב מה-20. הוא לא מחויב רטרואקטיבית על הימים שבהם לא היה לו אמצעי תשלום. זו החלטה, לא תקלה — אבל אם המדיניות העסקית שונה, זו השורה שצריך לשנות.

### G-5 — יציאה ממיצוי שלושת הניסיונות

התנאי `attempts < 3` ב-`on conflict do update` הורחב: חיוב שמיצה את ניסיונותיו ניתן לתפיסה **כאשר הלקוח שמר אמצעי תשלום חדש מזה שהמחזור הכושל ניסה** (`excluded.payment_method_refreshed_at > product_billing_charge.payment_method_refreshed_at`, או שהערך הישן NULL). במקרה כזה `attempts` חוזר ל-1 — ולכן נשאר בתוך האילוץ המקורי `between 1 and 3` — ו-`attempt_cycle` מתקדם, עם תקרה של 10.

היציאה היא **פעולה של הלקוח, לא חלוף זמן**. הרצות cron חוזרות בלי כרטיס חדש ממשיכות להחזיר `{"processed":0}`, כדי שהתיקון לא יהפוך ללולאת חיוב לא מפוקחת. הכפתור "עדכון אמצעי התשלום" בבאנר ה-`past_due` — שעד היום הבטיח משהו שהמערכת לא ידעה לקיים — הוא עכשיו המסלול שבאמת עובד. שלב 5.8 בסקריפט הבדיקה הידני (סעיף 6) כבר לא דורש SQL ידני; הוא אמור להסתיים ב-`{"processed":1,"succeeded":1,"failed":0}`.

### G-2 — לא נבנה כאן. היכן הווים כשיהיה ספק הודעות

G-2 דורש ספק מסרים (מייל/SMS) שאינו קיים בפרויקט, ולכן **לא נכתב עבורו שום קוד**. שלוש נקודות החיבור, לפי סדר החשיבות:

1. **כשל חיוב** — `packages/application/src/use-cases/manage-product-billing.ts`, בענף ה-`else` של `CollectDueProductSubscriptions.execute` (מיד אחרי `markChargeFailed` ורישום ה-audit `billing.charge_failed`). שם כבר יש `charge.billingEmail`, `charge.billingPeriod` ו-`failureCode`. זו ההודעה היחידה שבאמת חוסמת שחרור: לקוח שנכשל ולא נכנס לאפליקציה לא יודע כלום.
2. **ביטול** — `CancelProductSubscription.execute`, ליד רישום ה-audit `billing.subscription.cancelled`. עכשיו יש מה להגיד ומתי: `access_grace_starts_at` קובע את מועד הנעילה, והמייל צריך לשאת את אותו מספר ימים שהדיאלוג הבטיח.
3. **סוף חלון החסד** — אין לזה קורא כיום, כי `accessState` נגזר בקריאה ולא נשמר. יידרש job יומי נוסף (או הרחבה של `/billing/jobs/collect`) שסורק מנויים שבהם `access_grace_starts_at` בדיוק `GRACE_DAYS - 1` ימים אחורה, ושולח אזהרה לפני ההקפאה.

### טסטים שנוספו — ומה כל אחד מוכיח

| קובץ | מה נוסף | נכשל בלי התיקון כי… |
| --- | --- | --- |
| `apps/api/src/billing/access-state.test.ts` | 4 מקרים לעוגן הביטול | בלי `accessGraceStartsAt` הנגזרת מחזירה `frozen` לביטול של היום; כולל מקרה שהעוגן הישן מנצח כשהוא המאוחר, ומקרה fail-open לתאריך פגום |
| `apps/api/src/routes/billing.test.ts` | `abandoned card-update checkout (G-1)` — 2 טסטים | המצב היה `payment_method_pending` וההרצה החזירה `processed: 0`; הטסט השני שומר שלקוח **בלי** כרטיס עדיין עובר ל-`payment_method_pending` |
| `apps/api/src/routes/billing.test.ts` | `cancellation (G-3, G-4)` — 3 טסטים | `accessGraceStartsAt` היה חסר והנגזרת החזירה `frozen`; `nextChargeOn` נשאר NULL אחרי חיבור כרטיס מחדש והגבייה החזירה `processed: 0`; טסט שלישי שומר שתאריך חיוב קיים לא זז |
| `apps/api/src/routes/billing.test.ts` | `exhausted retry attempts (G-5)` — 2 טסטים | אחרי שלושה כשלים חיבור כרטיס חדש עדיין נתן `processed: 0`; הטסט השני שומר שהרצות חוזרות **בלי** כרטיס חדש נשארות 0 |
| `apps/api/src/routes/billing.test.ts` | `graceDays: 7` בטסט תוכנית הבסיס | השדה לא היה קיים בתשובת הנתיב |
| `apps/web/src/pages/BillingPage.test.tsx` | דיאלוג הביטול | הנוסח הישן לא הזכיר חסימת גישה ולא מספר ימים |

**חייב לרוץ על Windows (vitest לא זמין כאן):**

```
apps/api/src/billing/access-state.test.ts
apps/api/src/routes/billing.test.ts
apps/api/src/billing/cardcom-gateway.test.ts
packages/application/src/use-cases/manage-product-billing.test.ts
apps/web/src/pages/BillingPage.test.tsx
apps/web/src/components/AccountFrozenGate.test.tsx
```

שני האחרונים ושלישי-מהסוף לא שונו התנהגותית אך נגעו בהם: `BillingPlanResponse` קיבל שני שדות חדשים ולכן כל fixture של התוכנית עודכן. `packages/infrastructure/src/mocks/in-memory-billing-repository.ts` — המראה של ה-SQL — עודכן במקביל ומשמש את רוב הטסטים למעלה; אם ה-SQL וה-mock ייפרדו, הטסטים האלה יעברו בזמן שהייצור נשבר.

**מה לא תוקן וגם לא בסקופ:** G-2 (אין ספק מסרים), G-6 עד G-13. G-9 בפרט נשאר מסוכן: הסכום שנגבה עדיין `d.price_agorot` ולא `effectivePriceAgorot`, ומוסווה רק על ידי התנאי `launch_discount_percent = 0`.
