-- Regulation Engine review lifecycle (capability #11).
--
-- A regulation rule is reviewed CONTENT, not a decision engine: a conservative
-- factual statement with an explicit source citation, carried through a manual
-- review lifecycle (draft -> in_review -> approved -> active -> retired).
-- The reviewer is a free-text professional name recorded by a tenant manager —
-- CareDesk performs NO provider fulfilment and makes no validation claim of its
-- own: every row keeps requires_professional_validation = true until an
-- external professional process says otherwise.
--
-- Only rows with status = 'active' AND an effective date window covering the
-- evaluation date may ever feed assistant/wizard context (enforced at the
-- query layer in apps/api/src/regulation-rule-service.ts). Draft, in-review,
-- approved-but-not-activated and retired content must never leak there.

create table regulation_rule (
  tenant_id uuid not null references tenant (id),
  id uuid not null default gen_random_uuid(),
  rule_key text not null check (rule_key ~ '^[a-z0-9_]{3,80}$'),
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(title) between 3 and 200),
  -- The reviewed factual statement itself. Conservative wording only — never
  -- legal advice, never a computed legal outcome.
  statement text not null check (char_length(statement) between 10 and 2000),
  -- Explicit provenance: the named source (e.g. 'חוק שעות עבודה ומנוחה,
  -- התשי"א-1951') and the issuing authority.
  source_citation text not null check (char_length(source_citation) between 3 and 300),
  source_authority text
    check (source_authority is null or char_length(source_authority) between 2 and 200),
  -- Fail-closed provenance flag: content stays marked as requiring external
  -- professional validation; CareDesk never claims legal certification.
  requires_professional_validation boolean not null default true,
  effective_from date,
  effective_to date,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'active', 'retired')),
  -- Free-text professional reviewer name — a MANUAL review record, no provider.
  reviewed_by text check (reviewed_by is null or char_length(reviewed_by) between 2 and 200),
  reviewed_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint regulation_rule_key_version_unique unique (tenant_id, rule_key, version),
  constraint regulation_rule_dates check
    (effective_to is null or effective_from is null or effective_to >= effective_from),
  -- Reviewed states must carry their review evidence (fail closed).
  constraint regulation_rule_review_consistent check
    ((status in ('approved', 'active', 'retired')) = (reviewed_by is not null and reviewed_at is not null)),
  constraint regulation_rule_activation_consistent check
    ((status in ('active', 'retired')) = (activated_at is not null)),
  constraint regulation_rule_retirement_consistent check
    ((status = 'retired') = (retired_at is not null)),
  -- A rule can only be activated once its effective start date is known.
  constraint regulation_rule_active_effective check
    (status not in ('active', 'retired') or effective_from is not null)
);

-- Append-only lifecycle history: one row per accepted transition. The unique
-- (tenant_id, idempotency_key) makes transition replays observable and safe.
-- No update/delete grants: history is evidence (mirrors 0030).
create table regulation_rule_transition (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  rule_id uuid not null,
  from_status text not null
    check (from_status in ('draft', 'in_review', 'approved', 'active', 'retired')),
  to_status text not null
    check (to_status in ('draft', 'in_review', 'approved', 'active', 'retired')),
  changed_by uuid not null,
  reviewed_by text check (reviewed_by is null or char_length(reviewed_by) between 2 and 200),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  constraint regulation_rule_transition_same_tenant foreign key (tenant_id, rule_id)
    references regulation_rule (tenant_id, id)
);

create index regulation_rule_active_idx
  on regulation_rule (tenant_id, status, effective_from) where status = 'active';
create index regulation_rule_transition_rule_idx
  on regulation_rule_transition (tenant_id, rule_id, created_at);

alter table regulation_rule enable row level security;
alter table regulation_rule force row level security;
create policy regulation_rule_tenant_isolation on regulation_rule
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
alter table regulation_rule_transition enable row level security;
alter table regulation_rule_transition force row level security;
create policy regulation_rule_transition_tenant_isolation on regulation_rule_transition
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant select, insert, update on regulation_rule to caredesk_app;
grant select, insert on regulation_rule_transition to caredesk_app;

-- Seed reviewed content: deterministic, factual Israeli caregiver-employment
-- statements with explicit source citations. Seeded as status='approved' (a
-- tenant manager still has to activate them explicitly) and permanently marked
-- requires_professional_validation = true — reference content, NOT legal
-- advice. The migration role has BYPASSRLS, so every existing tenant receives
-- the same reviewed set. This seed content is mirrored in
-- apps/api/src/regulation-rule-service.ts (REGULATION_SEED_RULES) for the
-- in-memory development container — keep both in sync.
insert into regulation_rule (
  tenant_id, rule_key, version, title, statement, source_citation, source_authority,
  requires_professional_validation, effective_from, status, reviewed_by, reviewed_at
)
select
  t.id, seed.rule_key, 1, seed.title, seed.statement, seed.source_citation,
  seed.source_authority, true, date '2026-01-01', 'approved', seed.reviewed_by, now()
from tenant t
cross join (
  values
    (
      'weekly_rest_day',
      'מנוחה שבועית לעובד',
      'העובד זכאי למנוחה שבועית בכל שבוע. בהעסקת עובד סיעודי המתגורר בבית המעסיק נהוגה מנוחה שבועית רצופה של 25 שעות לפחות; ההיקף המדויק ואופן יישומו טעונים אימות מול גורם מקצועי.',
      'חוק שעות עבודה ומנוחה, התשי"א-1951',
      'זרוע העבודה — משרד העבודה',
      'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי'
    ),
    (
      'medical_insurance_obligation',
      'חובת ביטוח רפואי לעובד זר',
      'מעסיק של עובד זר חייב להסדיר לעובד, על חשבונו, ביטוח בריאות פרטי למשך כל תקופת ההעסקה, ולשמור אסמכתה לפוליסה בתוקף.',
      'חוק עובדים זרים, התשנ"א-1991; צו עובדים זרים (סל שירותי בריאות לעובד)',
      'רשות האוכלוסין וההגירה',
      'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי'
    ),
    (
      'written_employment_contract',
      'חובת חוזה עבודה בכתב',
      'על המעסיק להתקשר עם העובד הזר בחוזה עבודה בכתב, בשפה שהעובד מבין, ולמסור לעובד עותק ממנו.',
      'חוק עובדים זרים, התשנ"א-1991, סעיף 1ג',
      'רשות האוכלוסין וההגירה',
      'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי'
    ),
    (
      'visa_validity_tracking',
      'מעקב תוקף אשרה ורישיון עבודה',
      'העסקת עובד זר מותרת רק כאשר בידי העובד אשרה ורישיון עבודה בתוקף. יש לעקוב אחר מועד פקיעת הרישיון ולפעול לחידושו מבעוד מועד מול הגורמים המוסמכים.',
      'חוק הכניסה לישראל, התשי"ב-1952; נוהלי רשות האוכלוסין וההגירה',
      'רשות האוכלוסין וההגירה',
      'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי'
    )
) as seed(rule_key, title, statement, source_citation, source_authority, reviewed_by);

insert into schema_migrations (version) values ('0032_regulation_rule_lifecycle');
