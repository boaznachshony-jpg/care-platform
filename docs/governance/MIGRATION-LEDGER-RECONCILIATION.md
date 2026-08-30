# יישוב פנקס המיגרציות בייצור

> נוהל חד-פעמי, לבעלים בלבד. מריצים אותו ב-Supabase SQL Editor על פרויקט הייצור, בסדר הכתוב, ולא מדלגים על שלב.

עודכן: 30.8.2026 · שורש 2 בתוכנית `REVIEW-REMEDIATION-PLAN.md` · ממצאים REL-01, DB-02, REL-13

---

## למה זה נדרש

הרץ (`packages/db/src/migrate.ts`) לא כתב את הפנקס. הוא הסתמך על כך שכל קובץ SQL מסתיים ב-`insert into schema_migrations` משלו. 35 מתוך 38 הקבצים אכן עושים זאת. שלושה לא:

| מיגרציה | מה היא יוצרת |
| --- | --- |
| `0024_wave4_automation` | `document_intake_review`, `event_action_plan` |
| `0027_product_differentiation_completion` | `professional_review_request`, `ai_action_confirmation` |
| `0030_human_escalation_lifecycle` | עמודות `assigned_to_name` ו-`resolution_note`, אילוץ מצב חדש, וטבלת `professional_review_transition` |

התוצאה: בכל הרצה אחרי הראשונה הרץ ראה את `0024` כחסרה, הריץ אותה שוב, ונפל על `create table document_intake_review already exists`. הלולאה סדרתית — ולכן כל מה שאחריה מעולם לא נוסה. מ-0035 והלאה הוחל ידנית דרך ה-SQL Editor.

**מ-2026-08-30 הרץ רושם בעצמו כל מיגרציה, באותה טרנזקציה, עם `on conflict do nothing`.** המסמך הזה מיישב את מה שכבר קרה בייצור לפני התיקון.

**עדיין אין להריץ `pnpm db:migrate` על הייצור לפני שהנוהל הזה הושלם.** הרץ החדש יראה את שלוש המיגרציות כחסרות בדיוק כמו הישן, וייפול על אותה שגיאה.

---

## שלב 0 — גיבוי, לפני כל דבר אחר

ב-Supabase: **Database → Backups → Create backup**, והמתן עד שהוא מופיע ברשימה כ-Completed. בלי גיבוי שהושלם — אל תמשיך. אין PITR בפרויקט הזה (ראה `0035_workspace_version_history.sql:5`), והגיבוי היומי הוא כל מעטפת ההתאוששות.

רשום לעצמך את הזמן המדויק של הגיבוי. הוא ייכנס לרישום בסוף.

---

## שלב 1 — מה הפנקס אומר היום

```sql
select version, applied_at
  from schema_migrations
 order by version;
```

שמור את הפלט (העתק לקובץ). זו התמונה שלפני, והיא הראיה היחידה למה שהיה.

---

## שלב 2 — אילו מיגרציות חסרות בפנקס

השאילתה מחזירה שורה אחת לכל מיגרציה שהקוד דורש ושאיננה בפנקס:

```sql
with required(version) as (
  values
    ('0001_baseline'), ('0002_identity_tenancy'), ('0003_care_employment_core'),
    ('0004_force_rls_and_with_check'), ('0005_app_role'), ('0006_organizations_and_contacts'),
    ('0007_tasks_and_timeline'), ('0008_documents'), ('0009_audit_event'),
    ('0010_actor_resolution'), ('0011_tenant_workspace'), ('0012_workspace_files'),
    ('0013_family_access'), ('0014_product_billing'), ('0015_lock_down_supabase_public_schema'),
    ('0016_restore_actor_resolution_grant'), ('0017_restore_missing_pilot_workspace'),
    ('0018_self_service_account_bootstrap'), ('0019_backfill_self_service_accounts'),
    ('0020_sprint_zero_database_hardening'), ('0021_visa_renewal_persistence'),
    ('0022_remaining_visa_renewal_persistence'), ('0023_monthly_payroll_close'),
    ('0024_wave4_automation'), ('0025_wave5_collaboration_engagement'),
    ('0026_canonical_product_intelligence'), ('0026_wave5_worker_authorization'),
    ('0027_product_differentiation_completion'), ('0028_canonical_payroll_entry'),
    ('0029_automation_execution_receipt'), ('0030_human_escalation_lifecycle'),
    ('0031_binder_export_receipt'), ('0032_regulation_rule_lifecycle'),
    ('0033_governed_leave_ledger'), ('0034_scenario_expense'),
    ('0035_workspace_version_history'), ('0036_billing_lifecycle_recovery'),
    ('0037_close_workspace_delete_hole')
)
select r.version as missing_from_ledger
  from required r
  left join schema_migrations s on s.version = r.version
 where s.version is null
 order by r.version;
```

**הרשימה הזו חייבת להיות בדיוק שלוש השורות:** `0024_wave4_automation`, `0027_product_differentiation_completion`, `0030_human_escalation_lifecycle`.

- אם היא מכילה **פחות** — חלק מהן כבר יושבו. דלג בשלב 4 על מה שאיננו ברשימה.
- אם היא מכילה **יותר** — למשל `0035`, `0036` או `0037`, שהוחלו ידנית — **עצור.** משמעות הדבר שההחלה הידנית לא כללה את שורת ה-`insert` שבסוף הקובץ, וייתכן שהיא גם לא הושלמה. אל תוסיף שורות; ודא תחילה בשלב 3 שכל האובייקטים שהמיגרציה יוצרת אכן קיימים, ורק אז הוסף גם אותן לשלב 4.
- אם היא **ריקה** — אין מה ליישב. עבור ישר לשלב 5.

---

## שלב 3 — האם הסכימה באמת מכילה את מה שהמיגרציות האלה יוצרות

זו הבדיקה המהותית. אסור לרשום מיגרציה כמוחלת אם היא לא הוחלה בפועל — שורה כזו תגרום לרץ לדלג לנצח על מיגרציה אמיתית.

```sql
select
  '0024_wave4_automation' as migration,
  to_regclass('public.document_intake_review') is not null as document_intake_review,
  to_regclass('public.event_action_plan') is not null as event_action_plan,
  null::boolean as extra_1,
  null::boolean as extra_2
union all
select
  '0027_product_differentiation_completion',
  to_regclass('public.professional_review_request') is not null,
  to_regclass('public.ai_action_confirmation') is not null,
  null, null
union all
select
  '0030_human_escalation_lifecycle',
  to_regclass('public.professional_review_transition') is not null,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'professional_review_request'
       and column_name = 'assigned_to_name'
  ),
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'professional_review_request'
       and column_name = 'resolution_note'
  ),
  exists (
    select 1 from pg_constraint
     where conname = 'review_resolution_note_consistent'
       and conrelid = 'public.professional_review_request'::regclass
  );
```

**כל עמודה בכל שורה חייבת להחזיר `true`** (למעט עמודות ה-`extra` שהן `null` בשתי השורות הראשונות — הן קיימות רק כדי ליישר את מספר העמודות).

בדיקה משלימה ל-0030, שהיא הרגישה מכולן — אוצר המילים של המצב:

```sql
select pg_get_constraintdef(oid) as status_check
  from pg_constraint
 where conname = 'professional_review_request_status_check'
   and conrelid = 'public.professional_review_request'::regclass;
```

הפלט חייב להכיל `requested`, `acknowledged`, `in_review`, `resolved`, `cancelled` — **ולא** להכיל `draft` או `open`. אם הוא עדיין מכיל `open`, מיגרציה 0030 **לא** הוחלה, ואסור לרשום אותה.

**אם משהו בשלב הזה החזיר `false` — עצור והשאר את הפנקס כמות שהוא.** במקרה הזה המיגרציה החסרה היא חסרה באמת, וצריך להחיל אותה, לא לרשום אותה. הרץ החדש יעשה זאת נכון: `pnpm db:migrate --dry-run` ואז הרצה אמיתית.

---

## שלב 4 — הטרנזקציה שמוסיפה את השורות החסרות

מריצים **רק** אחרי ששלב 3 החזיר `true` בכל עמודה. בלוק אחד, טרנזקציה אחת:

```sql
begin;

insert into schema_migrations (version)
values
  ('0024_wave4_automation'),
  ('0027_product_differentiation_completion'),
  ('0030_human_escalation_lifecycle')
on conflict (version) do nothing;

commit;
```

הבלוק כולו נשלח כהרצה אחת. אין לפצל אותו לשלוש הרצות נפרדות ב-SQL Editor — כל הרצה שם היא חיבור משלה, ו-`begin` בהרצה אחת לא יחבור ל-`commit` בהרצה אחרת.

זהו בדיוק דפוס התיקון שכבר משמש ב-`database/migrations/0017_restore_missing_pilot_workspace.sql:56-61`. ה-`on conflict (version) do nothing` הופך את הבלוק לבטוח להרצה חוזרת: הרצה שנייה לא תשנה דבר ולא תיכשל. ההוכחה שהוא עבד היא שלב 5, ולא הפלט של הבלוק הזה.

**לא מוסיפים שורה למיגרציה שאיננה ברשימת שלב 2, ולא מוסיפים שורה למיגרציה ששלב 3 לא אישר.**

---

## שלב 5 — שאילתת ההוכחה

זו השאילתה שמוכיחה שהיישוב עבד. הרץ אותה אחרי ה-`commit`:

```sql
with required(version) as (
  values
    ('0001_baseline'), ('0002_identity_tenancy'), ('0003_care_employment_core'),
    ('0004_force_rls_and_with_check'), ('0005_app_role'), ('0006_organizations_and_contacts'),
    ('0007_tasks_and_timeline'), ('0008_documents'), ('0009_audit_event'),
    ('0010_actor_resolution'), ('0011_tenant_workspace'), ('0012_workspace_files'),
    ('0013_family_access'), ('0014_product_billing'), ('0015_lock_down_supabase_public_schema'),
    ('0016_restore_actor_resolution_grant'), ('0017_restore_missing_pilot_workspace'),
    ('0018_self_service_account_bootstrap'), ('0019_backfill_self_service_accounts'),
    ('0020_sprint_zero_database_hardening'), ('0021_visa_renewal_persistence'),
    ('0022_remaining_visa_renewal_persistence'), ('0023_monthly_payroll_close'),
    ('0024_wave4_automation'), ('0025_wave5_collaboration_engagement'),
    ('0026_canonical_product_intelligence'), ('0026_wave5_worker_authorization'),
    ('0027_product_differentiation_completion'), ('0028_canonical_payroll_entry'),
    ('0029_automation_execution_receipt'), ('0030_human_escalation_lifecycle'),
    ('0031_binder_export_receipt'), ('0032_regulation_rule_lifecycle'),
    ('0033_governed_leave_ledger'), ('0034_scenario_expense'),
    ('0035_workspace_version_history'), ('0036_billing_lifecycle_recovery'),
    ('0037_close_workspace_delete_hole')
)
select
  (select count(*) from required)                            as required_count,
  (select count(*) from required r
     join schema_migrations s on s.version = r.version)       as recorded_count,
  (select count(*) from required r
     left join schema_migrations s on s.version = r.version
    where s.version is null)                                  as still_missing;
```

**התוצאה התקינה היחידה: `required_count = 38`, `recorded_count = 38`, `still_missing = 0`.**

זו אותה השוואה בדיוק שהקוד מבצע: `packages/db/src/required-migrations.ts` מחזיק את הרשימה, ו-`/ready` נכשל כשמשהו ברשימה חסר מהפנקס. `scripts/check-migration-ledger.mjs` נכשל ב-CI אם הרשימה בקוד מפסיקה להתאים לתיקיית המיגרציות, כך שרשימה זו לא יכולה להתיישן בשקט.

---

## שלב 6 — האימות מבחוץ

1. פתח את `/ready` של ה-API בייצור. הוא חייב להחזיר `200` עם `checks.database = "ok"`.
   אם הוא מחזיר `503` עם `Database is behind the code` — הפנקס עדיין חסר; חזור לשלב 2.
2. הרץ מקומית, כשהיעד הוא הייצור, **תחילה בהרצה יבשה**:

   ```
   pnpm db:migrate --dry-run
   ```

   הפלט חייב להיות `No new migrations - database is up to date.`
   שים לב: הרצה על הייצור דורשת `PRODUCTION_SUPABASE_PROJECT_REF`, `CAREDESK_MIGRATE_PROJECT_REF` המצביע על אותו ref, ובנוסף `CAREDESK_MIGRATE_ALLOW_PRODUCTION=1` להרצה אמיתית. הרץ מסרב אחרת — זה מכוון.

3. רשום ב-`AGENT_STATUS.md` את מועד הגיבוי משלב 0, את פלט שלב 1, ואת שאילתת ההוכחה משלב 5.

---

## מה נשאר פתוח אחרי הנוהל הזה

הפנקס יאמר שהמיגרציות הוחלו. הוא **לא** יוכיח שהטקסט שהוחל זהה לטקסט שבמאגר — מיגרציה שהוחלה ידנית או מענף לא ממוזג יכולה להיות גרסה אחרת של אותו קובץ (REL-13). התיקון לכך הוא עמודת `checksum` בפנקס, והוא לא נכלל בנוהל הזה.

עד אז, הכלל: **מיגרציות מוחלות רק מ-`main`, ורק דרך `pnpm db:migrate`.**
