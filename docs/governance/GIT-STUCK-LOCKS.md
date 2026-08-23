# נעילות git תקועות — איך מזהים ומה עושים

> נכתב אחרי שתי נעילות בנות 27 שעות חסמו כל פעולת git במשך יום עבודה שלם,
> והתחזו לחמש תקלות שונות לפני שזוהו.

עודכן: 23.8.2026

---

## איך זה נראה כשזה קורה

התסמינים **לא** נראים כמו בעיית git. הם נראים כמו תקלות אחרות לגמרי:

| מה שנראה | מה שקרה באמת |
|---|---|
| "אפס ריצות workflow" ב-GitHub Actions | ה-commit מעולם לא נוצר, ולכן לא היה מה להריץ |
| `git push` מדפיס "Everything up-to-date" | הפקודה שלפניו נכשלה בשקט; אין מה לדחוף |
| `git stash` לא עושה כלום ולא מדפיס שגיאה | הנעילה חסמה אותו |
| עץ העבודה "תקוע" על ענף ישן | `git switch` נכשל ולא הודיע בבירור |
| CI "לא מופעל" ב-PR | אותו שורש — לא נדחף commit חדש |

**הסימן המובהק** הוא השורה הזו, שקל לפספס בין שאר הפלט:

```
fatal: Unable to create '.../.git/index.lock': File exists.
Another git process seems to be running in this repository, or the lock file may be stale
```

---

## איך מוודאים שזו נעילה תקועה ולא תהליך פעיל

**אל תמחקו נעילה של תהליך שרץ.** ההבחנה פשוטה:

```powershell
Get-Item "<repo>\.git\index.lock" | Select-Object Length, CreationTime
```

- **גודל 0 בתים** = תהליך שקרס לפני שהספיק לכתוב. תקועה.
- **גילה שעות או ימים** = תקועה. תהליך אמיתי חי שניות.
- אם היא נוצרה לפני רגע ויש בה תוכן — המתינו. משהו באמת רץ.

בתקרית שלנו: אפס בתים, בת 27 שעות. חד-משמעית תקועה.

---

## מה עושים

יש **שני** סוגי נעילות, וצריך לבדוק את שניהם. אנחנו טיפלנו בראשונה וגילינו שהשנייה עדיין חוסמת:

```powershell
Remove-Item "<repo>\.git\index.lock" -Force
Remove-Item "<repo>\.git\refs\heads\<שם-הענף>.lock" -Force
```

הראשונה חוסמת כל פעולה שנוגעת באינדקס — `add`, `commit`, `switch`, `stash`.
השנייה חוסמת עדכון של ענף מסוים — `commit` ייכשל עם `cannot lock ref 'HEAD'`.

**לסריקה של כל הנעילות בבת אחת:**

```powershell
Get-ChildItem "<repo>\.git" -Recurse -Filter "*.lock" | Select-Object FullName, Length, CreationTime
```

מחיקת נעילה תקועה **אינה נוגעת בשום נתון**. היא רק מסירה דגל.

---

## למה זה קרה כאן, וכנראה יקרה שוב

הרפו יושב בתוך **OneDrive**. סנכרון ענן נוגע בקבצים בזמן ש-git עובד עליהם, וזה מקור מוכר לנעילות תקועות ולשגיאות `Operation not permitted`. אותה סיבה מסבירה את האזהרות `unable to unlink '.git/objects/...'` שהופיעו לאורך כל היום.

**מה שכדאי לשקול:** להעביר את הרפו אל מחוץ ל-OneDrive, למשל `C:\dev\care-platform`. את התיקייה ב-OneDrive אפשר להשאיר למסמכים. זה מבטל את מקור הבעיה במקום לנקות אחריה.

**עד אז** — אם פקודת git מתנהגת מוזר, בדקו נעילות **לפני** שמחפשים הסבר אחר. זה היה חוסך לנו שעות.

---

## עקיפה שעבדה, ושווה להכיר

כשעץ העבודה נעול או מלוכלך, אפשר לבנות commit **בלי לגעת בו בכלל** — קריאת עץ לאינדקס זמני, יצירת commit ועדכון הענף ישירות:

```bash
export GIT_INDEX_FILE=/tmp/idx
git read-tree origin/main
git add -- <קבצים>
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -p origin/main -m "...")
git update-ref refs/heads/<ענף> "$COMMIT"
```

כך נבנו כל הענפים של היום למרות שהאינדקס היה נעול. הם נוצרו תקינים — רק הדחיפה דרשה פעולה ידנית.

**וליצירת commit ריק על ענף קיים בלי checkout:**

```bash
TREE=$(git rev-parse <ענף>^{tree})
NEW=$(git commit-tree "$TREE" -p <ענף> -m "chore: trigger CI")
git update-ref refs/heads/<ענף> "$NEW"
```

---

## הקשר: למה בכלל היה צריך commit ריק

ה-CI לא הופעל כי `push` ב-`ci.yml` מוגבל ל-`main` ו-`staging` בלבד, ואירוע `pull_request` לא נרשם כשה-PR נפתח באותו רגע שבו הענף נדחף.

**שתי דרכים לפתור:**

1. `workflow_dispatch` — הפעלה ידנית מ-Actions, בחירת הענף, "Run workflow". קיים כבר ב-`ci.yml` ועבד.
2. להוסיף טריגר מפורש:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

השני עדיף, ומתוכנן להיכנס עם PR מטריצת הרוחבים.
