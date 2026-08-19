/* eslint-disable no-restricted-syntax -- Seeded regulation statements and their official source citations are reviewed source data mirrored from migration 0032, not interface copy (same exemption as licensed-bureaus.ts). */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Regulation Engine review lifecycle (capability #11, migration 0032).
 *
 * A regulation rule is reviewed CONTENT — a conservative factual statement
 * with an explicit source citation — carried through a manual lifecycle:
 * draft → in_review → approved → active → retired. The reviewer is a
 * free-text professional name recorded by a tenant manager; CareDesk performs
 * NO provider fulfilment and never claims legal validation of its own
 * (`requiresProfessionalValidation` stays true on every row).
 *
 * `listActiveForContext` is the ONLY query allowed to feed assistant/wizard
 * rule context: it returns exclusively status='active' rules whose effective
 * date window covers the evaluation date. Draft, in-review,
 * approved-but-not-activated and retired content must never leak there.
 */

export const REGULATION_RULE_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'active',
  'retired',
] as const;
export type RegulationRuleStatus = (typeof REGULATION_RULE_STATUSES)[number];

/**
 * The only legal review lifecycle. Strictly linear and fail-closed: content
 * cannot skip review, cannot reach the assistant without explicit activation,
 * and a retired rule never comes back (author a new version instead).
 */
export const REGULATION_RULE_TRANSITIONS: Record<
  RegulationRuleStatus,
  readonly RegulationRuleStatus[]
> = {
  draft: ['in_review'],
  in_review: ['approved'],
  approved: ['active'],
  active: ['retired'],
  retired: [],
};

export interface RegulationRule {
  id: string;
  ruleKey: string;
  version: number;
  title: string;
  statement: string;
  sourceCitation: string;
  sourceAuthority: string | null;
  requiresProfessionalValidation: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: RegulationRuleStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegulationRuleTransitionRecord {
  id: string;
  fromStatus: RegulationRuleStatus;
  toStatus: RegulationRuleStatus;
  changedBy: string;
  reviewedBy: string | null;
  createdAt: string;
}

export interface CreateRegulationRuleInput {
  ruleKey: string;
  title: string;
  statement: string;
  sourceCitation: string;
  sourceAuthority?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

type Actor = { tenantId: string; userId: string; correlationId: string };

/** Only the employer (owner) or a manager may author or transition content. */
const RULE_ADMIN_ROLES = new Set(['owner', 'manager']);

/**
 * THE active-content filter. Pure and deterministic so it can be proven in
 * isolation: anything that is not status='active' with a known effective
 * window covering `asOf` is excluded — draft, in_review, approved and retired
 * rules never pass, and neither does an active rule outside its dates.
 */
export function filterEffectiveActiveRules<
  T extends Pick<RegulationRule, 'status' | 'effectiveFrom' | 'effectiveTo'>,
>(rules: readonly T[], asOf: string): T[] {
  return rules.filter(
    (rule) =>
      rule.status === 'active' &&
      rule.effectiveFrom !== null &&
      rule.effectiveFrom <= asOf &&
      (rule.effectiveTo === null || rule.effectiveTo >= asOf),
  );
}

/**
 * Seed reviewed content mirrored from migration 0032 for the in-memory
 * development container — deterministic factual statements with source
 * citations, seeded 'approved' (never 'active': a manager still activates
 * explicitly) and permanently flagged as requiring professional validation.
 * Reference content, NOT legal advice. Keep in sync with the migration.
 */
export const REGULATION_SEED_RULES: ReadonlyArray<
  Pick<
    RegulationRule,
    'ruleKey' | 'title' | 'statement' | 'sourceCitation' | 'sourceAuthority' | 'reviewedBy'
  >
> = [
  {
    ruleKey: 'weekly_rest_day',
    title: 'מנוחה שבועית לעובד',
    statement:
      'העובד זכאי למנוחה שבועית בכל שבוע. בהעסקת עובד סיעודי המתגורר בבית המעסיק נהוגה מנוחה שבועית רצופה של 25 שעות לפחות; ההיקף המדויק ואופן יישומו טעונים אימות מול גורם מקצועי.',
    sourceCitation: 'חוק שעות עבודה ומנוחה, התשי"א-1951',
    sourceAuthority: 'זרוע העבודה — משרד העבודה',
    reviewedBy: 'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי',
  },
  {
    ruleKey: 'medical_insurance_obligation',
    title: 'חובת ביטוח רפואי לעובד זר',
    statement:
      'מעסיק של עובד זר חייב להסדיר לעובד, על חשבונו, ביטוח בריאות פרטי למשך כל תקופת ההעסקה, ולשמור אסמכתה לפוליסה בתוקף.',
    sourceCitation: 'חוק עובדים זרים, התשנ"א-1991; צו עובדים זרים (סל שירותי בריאות לעובד)',
    sourceAuthority: 'רשות האוכלוסין וההגירה',
    reviewedBy: 'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי',
  },
  {
    ruleKey: 'written_employment_contract',
    title: 'חובת חוזה עבודה בכתב',
    statement:
      'על המעסיק להתקשר עם העובד הזר בחוזה עבודה בכתב, בשפה שהעובד מבין, ולמסור לעובד עותק ממנו.',
    sourceCitation: 'חוק עובדים זרים, התשנ"א-1991, סעיף 1ג',
    sourceAuthority: 'רשות האוכלוסין וההגירה',
    reviewedBy: 'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי',
  },
  {
    ruleKey: 'visa_validity_tracking',
    title: 'מעקב תוקף אשרה ורישיון עבודה',
    statement:
      'העסקת עובד זר מותרת רק כאשר בידי העובד אשרה ורישיון עבודה בתוקף. יש לעקוב אחר מועד פקיעת הרישיון ולפעול לחידושו מבעוד מועד מול הגורמים המוסמכים.',
    sourceCitation: 'חוק הכניסה לישראל, התשי"ב-1952; נוהלי רשות האוכלוסין וההגירה',
    sourceAuthority: 'רשות האוכלוסין וההגירה',
    reviewedBy: 'תוכן ייחוס ראשוני של CareDesk — טעון אימות על ידי גורם מקצועי',
  },
];

const SEED_EFFECTIVE_FROM = '2026-01-01';

export interface RegulationRuleWriteResult {
  rule: RegulationRule;
  replayed: boolean;
}

export interface RegulationRuleDetail {
  rule: RegulationRule;
  history: RegulationRuleTransitionRecord[];
}

export interface RegulationRuleService {
  /** Admin listing — every status, for the manager-facing lifecycle UI. */
  list(actor: Actor): Promise<RegulationRule[]>;
  get(actor: Actor, ruleId: string): Promise<RegulationRuleDetail>;
  create(
    actor: Actor,
    input: CreateRegulationRuleInput,
    idempotencyKey: string,
  ): Promise<RegulationRuleWriteResult>;
  transition(
    actor: Actor,
    ruleId: string,
    toStatus: RegulationRuleStatus,
    reviewedBy: string | undefined,
    idempotencyKey: string,
  ): Promise<RegulationRuleWriteResult>;
  /** The ONLY query allowed to feed assistant/wizard rule context. */
  listActiveForContext(actor: Actor, asOf: string): Promise<RegulationRule[]>;
}

function assertLegalTransition(
  from: RegulationRuleStatus,
  to: RegulationRuleStatus,
  reviewedBy: string | undefined,
  effectiveFrom: string | null,
): void {
  if (!REGULATION_RULE_TRANSITIONS[from].includes(to)) throw new Error('invalid_transition');
  if (to === 'approved' && !reviewedBy) throw new Error('reviewer_required');
  if (to === 'active' && effectiveFrom === null) throw new Error('effective_from_required');
}

function createRequestHash(input: CreateRegulationRuleInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ruleKey: input.ruleKey,
        title: input.title,
        statement: input.statement,
        sourceCitation: input.sourceCitation,
        sourceAuthority: input.sourceAuthority ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
      }),
    )
    .digest('hex');
}

type RuleRow = {
  id: string;
  rule_key: string;
  version: number;
  title: string;
  statement: string;
  source_citation: string;
  source_authority: string | null;
  requires_professional_validation: boolean;
  effective_from: string | null;
  effective_to: string | null;
  status: RegulationRuleStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  activated_at: Date | null;
  retired_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const ruleColumns = `id, rule_key, version, title, statement, source_citation, source_authority,
  requires_professional_validation, effective_from::text as effective_from,
  effective_to::text as effective_to, status, reviewed_by, reviewed_at, activated_at,
  retired_at, created_at, updated_at`;

function rowToRule(row: RuleRow): RegulationRule {
  return {
    id: row.id,
    ruleKey: row.rule_key,
    version: row.version,
    title: row.title,
    statement: row.statement,
    sourceCitation: row.source_citation,
    sourceAuthority: row.source_authority,
    requiresProfessionalValidation: row.requires_professional_validation,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    activatedAt: row.activated_at ? row.activated_at.toISOString() : null,
    retiredAt: row.retired_at ? row.retired_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgRegulationRuleService implements RegulationRuleService {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** RLS scopes the membership lookup to the actor's own tenant. */
  private async assertManager(client: PoolClient, actor: Actor): Promise<void> {
    const result = await client.query<{ role: string }>(
      `select role from tenant_membership where user_id=$1 and status='active' limit 1`,
      [actor.userId],
    );
    const role = result.rows[0]?.role ?? null;
    if (!role || !RULE_ADMIN_ROLES.has(role)) throw new Error('forbidden_role');
  }

  private async recordAudit(
    client: PoolClient,
    actor: Actor,
    action: string,
    ruleId: string,
    changeSummary: string,
  ): Promise<void> {
    await client.query(
      `insert into audit_event (id,tenant_id,actor_id,action,resource_type,resource_id,occurred_at,correlation_id,purpose,change_summary,sensitivity)
       values ($1,$2,$3,$4,'regulation_rule',$5,now(),$6,'regulation_lifecycle',$7,'general')`,
      [
        randomUUID(),
        actor.tenantId,
        actor.userId,
        action,
        ruleId,
        actor.correlationId,
        changeSummary,
      ],
    );
  }

  async list(actor: Actor): Promise<RegulationRule[]> {
    return this.tx(actor.tenantId, async (client) => {
      const result = await client.query<RuleRow>(
        `select ${ruleColumns} from regulation_rule order by rule_key, version desc limit 200`,
      );
      return result.rows.map(rowToRule);
    });
  }

  async get(actor: Actor, ruleId: string): Promise<RegulationRuleDetail> {
    return this.tx(actor.tenantId, async (client) => {
      const rule = (
        await client.query<RuleRow>(`select ${ruleColumns} from regulation_rule where id=$1`, [
          ruleId,
        ])
      ).rows[0];
      if (!rule) throw new Error('rule_not_found');
      const history = await client.query<{
        id: string;
        from_status: RegulationRuleStatus;
        to_status: RegulationRuleStatus;
        changed_by: string;
        reviewed_by: string | null;
        created_at: Date;
      }>(
        `select id, from_status, to_status, changed_by, reviewed_by, created_at
         from regulation_rule_transition where rule_id=$1 order by created_at asc`,
        [ruleId],
      );
      return {
        rule: rowToRule(rule),
        history: history.rows.map((row) => ({
          id: row.id,
          fromStatus: row.from_status,
          toStatus: row.to_status,
          changedBy: row.changed_by,
          reviewedBy: row.reviewed_by,
          createdAt: row.created_at.toISOString(),
        })),
      };
    });
  }

  async create(
    actor: Actor,
    input: CreateRegulationRuleInput,
    idempotencyKey: string,
  ): Promise<RegulationRuleWriteResult> {
    return this.tx(actor.tenantId, async (client) => {
      await this.assertManager(client, actor);
      const requestHash = createRequestHash(input);
      const replay = await client.query<{ request_hash: string; response: RegulationRule }>(
        `select request_hash, response from idempotency_record
         where operation='regulation_rule.create' and idempotency_key=$1 for update`,
        [idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== requestHash) throw new Error('idempotency_conflict');
        return { rule: replay.rows[0].response, replayed: true };
      }
      const duplicate = await client.query(
        `select 1 from regulation_rule where rule_key=$1 and version=1`,
        [input.ruleKey],
      );
      if (duplicate.rowCount) throw new Error('rule_exists');
      const inserted = await client.query<RuleRow>(
        `insert into regulation_rule
           (tenant_id, rule_key, version, title, statement, source_citation, source_authority,
            effective_from, effective_to, status, created_by)
         values ($1,$2,1,$3,$4,$5,$6,$7,$8,'draft',$9)
         returning ${ruleColumns}`,
        [
          actor.tenantId,
          input.ruleKey,
          input.title,
          input.statement,
          input.sourceCitation,
          input.sourceAuthority ?? null,
          input.effectiveFrom ?? null,
          input.effectiveTo ?? null,
          actor.userId,
        ],
      );
      const rule = rowToRule(inserted.rows[0]!);
      await this.recordAudit(
        client,
        actor,
        'regulation_rule.created',
        rule.id,
        `Regulation rule ${rule.ruleKey} v${rule.version} drafted.`,
      );
      await client.query(
        `insert into idempotency_record (tenant_id,operation,idempotency_key,request_hash,response)
         values ($1,'regulation_rule.create',$2,$3,$4)`,
        [actor.tenantId, idempotencyKey, requestHash, JSON.stringify(rule)],
      );
      return { rule, replayed: false };
    });
  }

  async transition(
    actor: Actor,
    ruleId: string,
    toStatus: RegulationRuleStatus,
    reviewedBy: string | undefined,
    idempotencyKey: string,
  ): Promise<RegulationRuleWriteResult> {
    return this.tx(actor.tenantId, async (client) => {
      await this.assertManager(client, actor);
      const replay = await client.query<{ rule_id: string }>(
        `select rule_id from regulation_rule_transition where idempotency_key=$1`,
        [idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].rule_id !== ruleId) throw new Error('idempotency_conflict');
        const current = (
          await client.query<RuleRow>(`select ${ruleColumns} from regulation_rule where id=$1`, [
            ruleId,
          ])
        ).rows[0];
        if (!current) throw new Error('rule_not_found');
        return { rule: rowToRule(current), replayed: true };
      }
      const current = (
        await client.query<{ status: RegulationRuleStatus; effective_from: string | null }>(
          `select status, effective_from::text as effective_from
           from regulation_rule where id=$1 for update`,
          [ruleId],
        )
      ).rows[0];
      if (!current) throw new Error('rule_not_found');
      assertLegalTransition(current.status, toStatus, reviewedBy, current.effective_from);
      const updated = await client.query<RuleRow>(
        `update regulation_rule set status=$2,
           reviewed_by = case when $2='approved' then $3 else reviewed_by end,
           reviewed_at = case when $2='approved' then now() else reviewed_at end,
           activated_at = case when $2='active' then now() else activated_at end,
           retired_at = case when $2='retired' then now() else retired_at end,
           updated_at = now()
         where id=$1 returning ${ruleColumns}`,
        [ruleId, toStatus, reviewedBy ?? null],
      );
      const rule = rowToRule(updated.rows[0]!);
      await client.query(
        `insert into regulation_rule_transition
           (tenant_id, rule_id, from_status, to_status, changed_by, reviewed_by, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          actor.tenantId,
          ruleId,
          current.status,
          toStatus,
          actor.userId,
          reviewedBy ?? null,
          idempotencyKey,
        ],
      );
      await this.recordAudit(
        client,
        actor,
        'regulation_rule.status_changed',
        ruleId,
        `Regulation rule ${rule.ruleKey} moved from ${current.status} to ${toStatus} (manual review lifecycle).`,
      );
      return { rule, replayed: false };
    });
  }

  async listActiveForContext(actor: Actor, asOf: string): Promise<RegulationRule[]> {
    // The status/effective-date filter lives in the SQL itself so no caller
    // can ever receive draft, in-review, approved-only or retired content.
    return this.tx(actor.tenantId, async (client) => {
      const result = await client.query<RuleRow>(
        `select ${ruleColumns} from regulation_rule
         where status='active' and effective_from is not null and effective_from <= $1
           and (effective_to is null or effective_to >= $1)
         order by rule_key limit 100`,
        [asOf],
      );
      return result.rows.map(rowToRule);
    });
  }
}

export interface InMemoryRegulationRuleDeps {
  /** Same authenticated read the Family Access page uses (binder pattern). */
  resolveRole: (actor: Actor) => Promise<string | null>;
  audit: {
    record(event: {
      tenantId: string;
      actorId: string;
      action: string;
      resourceType: string;
      resourceId: string;
      correlationId: string;
      occurredAt: string;
      changeSummary?: string;
      permissionDecision?: 'allowed' | 'denied';
      reason?: string;
    }): Promise<void>;
  };
}

/**
 * Development/test fallback (no DATABASE_URL). Same contract, lifecycle and
 * error codes as the Postgres service; each tenant is lazily seeded with the
 * same reviewed 'approved' content the migration ships.
 */
export class InMemoryRegulationRuleService implements RegulationRuleService {
  private readonly rulesByTenant = new Map<string, RegulationRule[]>();
  private readonly historiesByTenant = new Map<
    string,
    Map<string, RegulationRuleTransitionRecord[]>
  >();
  private readonly transitionIdempotency = new Map<string, string>();
  private readonly createIdempotency = new Map<
    string,
    { requestHash: string; rule: RegulationRule }
  >();

  constructor(private readonly deps: InMemoryRegulationRuleDeps) {}

  private tenantRules(tenantId: string): RegulationRule[] {
    let rules = this.rulesByTenant.get(tenantId);
    if (!rules) {
      const now = new Date().toISOString();
      rules = REGULATION_SEED_RULES.map((seed) => ({
        id: randomUUID(),
        ruleKey: seed.ruleKey,
        version: 1,
        title: seed.title,
        statement: seed.statement,
        sourceCitation: seed.sourceCitation,
        sourceAuthority: seed.sourceAuthority,
        requiresProfessionalValidation: true,
        effectiveFrom: SEED_EFFECTIVE_FROM,
        effectiveTo: null,
        status: 'approved' as const,
        reviewedBy: seed.reviewedBy,
        reviewedAt: now,
        activatedAt: null,
        retiredAt: null,
        createdAt: now,
        updatedAt: now,
      }));
      this.rulesByTenant.set(tenantId, rules);
    }
    return rules;
  }

  private tenantHistories(tenantId: string): Map<string, RegulationRuleTransitionRecord[]> {
    let histories = this.historiesByTenant.get(tenantId);
    if (!histories) {
      histories = new Map();
      this.historiesByTenant.set(tenantId, histories);
    }
    return histories;
  }

  private async assertManager(actor: Actor, resourceId: string): Promise<void> {
    const role = await this.deps.resolveRole(actor);
    if (role && RULE_ADMIN_ROLES.has(role)) return;
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'regulation_rule.denied',
      resourceType: 'regulation_rule',
      resourceId,
      correlationId: actor.correlationId,
      occurredAt: new Date().toISOString(),
      permissionDecision: 'denied',
      reason: 'regulation rule lifecycle requires the owner or manager role',
    });
    throw new Error('forbidden_role');
  }

  async list(actor: Actor): Promise<RegulationRule[]> {
    return this.tenantRules(actor.tenantId)
      .map((rule) => ({ ...rule }))
      .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || b.version - a.version);
  }

  async get(actor: Actor, ruleId: string): Promise<RegulationRuleDetail> {
    const rule = this.tenantRules(actor.tenantId).find((row) => row.id === ruleId);
    if (!rule) throw new Error('rule_not_found');
    const history = this.tenantHistories(actor.tenantId).get(ruleId) ?? [];
    return { rule: { ...rule }, history: history.map((row) => ({ ...row })) };
  }

  async create(
    actor: Actor,
    input: CreateRegulationRuleInput,
    idempotencyKey: string,
  ): Promise<RegulationRuleWriteResult> {
    await this.assertManager(actor, input.ruleKey);
    const requestHash = createRequestHash(input);
    const idempotencyId = `${actor.tenantId}:${idempotencyKey}`;
    const replay = this.createIdempotency.get(idempotencyId);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new Error('idempotency_conflict');
      return { rule: { ...replay.rule }, replayed: true };
    }
    const rules = this.tenantRules(actor.tenantId);
    if (rules.some((rule) => rule.ruleKey === input.ruleKey && rule.version === 1))
      throw new Error('rule_exists');
    const now = new Date().toISOString();
    const rule: RegulationRule = {
      id: randomUUID(),
      ruleKey: input.ruleKey,
      version: 1,
      title: input.title,
      statement: input.statement,
      sourceCitation: input.sourceCitation,
      sourceAuthority: input.sourceAuthority ?? null,
      requiresProfessionalValidation: true,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      status: 'draft',
      reviewedBy: null,
      reviewedAt: null,
      activatedAt: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    rules.push(rule);
    this.createIdempotency.set(idempotencyId, { requestHash, rule });
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'regulation_rule.created',
      resourceType: 'regulation_rule',
      resourceId: rule.id,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Regulation rule ${rule.ruleKey} v${rule.version} drafted.`,
    });
    return { rule: { ...rule }, replayed: false };
  }

  async transition(
    actor: Actor,
    ruleId: string,
    toStatus: RegulationRuleStatus,
    reviewedBy: string | undefined,
    idempotencyKey: string,
  ): Promise<RegulationRuleWriteResult> {
    await this.assertManager(actor, ruleId);
    const idempotencyId = `${actor.tenantId}:${idempotencyKey}`;
    const replayRuleId = this.transitionIdempotency.get(idempotencyId);
    if (replayRuleId) {
      if (replayRuleId !== ruleId) throw new Error('idempotency_conflict');
      const rule = this.tenantRules(actor.tenantId).find((row) => row.id === ruleId);
      if (!rule) throw new Error('rule_not_found');
      return { rule: { ...rule }, replayed: true };
    }
    const rule = this.tenantRules(actor.tenantId).find((row) => row.id === ruleId);
    if (!rule) throw new Error('rule_not_found');
    assertLegalTransition(rule.status, toStatus, reviewedBy, rule.effectiveFrom);
    const now = new Date().toISOString();
    const fromStatus = rule.status;
    rule.status = toStatus;
    if (toStatus === 'approved') {
      rule.reviewedBy = reviewedBy ?? rule.reviewedBy;
      rule.reviewedAt = now;
    }
    if (toStatus === 'active') rule.activatedAt = now;
    if (toStatus === 'retired') rule.retiredAt = now;
    rule.updatedAt = now;
    const histories = this.tenantHistories(actor.tenantId);
    histories.set(ruleId, [
      ...(histories.get(ruleId) ?? []),
      {
        id: randomUUID(),
        fromStatus,
        toStatus,
        changedBy: actor.userId,
        reviewedBy: reviewedBy ?? null,
        createdAt: now,
      },
    ]);
    this.transitionIdempotency.set(idempotencyId, ruleId);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action: 'regulation_rule.status_changed',
      resourceType: 'regulation_rule',
      resourceId: ruleId,
      correlationId: actor.correlationId,
      occurredAt: now,
      changeSummary: `Regulation rule ${rule.ruleKey} moved from ${fromStatus} to ${toStatus} (manual review lifecycle).`,
    });
    return { rule: { ...rule }, replayed: false };
  }

  async listActiveForContext(actor: Actor, asOf: string): Promise<RegulationRule[]> {
    return filterEffectiveActiveRules(this.tenantRules(actor.tenantId), asOf)
      .map((rule) => ({ ...rule }))
      .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
  }
}
