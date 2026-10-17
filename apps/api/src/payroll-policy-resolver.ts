import type { PoolClient } from 'pg';
import { PayrollPolicyError, type VerifiedPayrollRule } from '@caredesk/domain';
import { VerifiedPayrollRuleSchema } from '@caredesk/schemas';

/** The transaction's RLS tenant, not the request body, owns these reviewed rules. */
export async function resolveVerifiedPayrollRules(
  client: PoolClient,
  month: string,
): Promise<VerifiedPayrollRule[]> {
  const result = await client.query<{
    id: string;
    code: string;
    version: number;
    status: 'active';
    effective_from: string;
    effective_to: string | null;
    source_reference: string;
    source_verified_at: Date;
    reviewed_by: string;
    approved_at: Date;
    config: VerifiedPayrollRule['config'];
  }>(
    `select id,code,version,status,effective_from::text,effective_to::text,
      source_reference,source_verified_at,reviewed_by,approved_at,config
     from payroll_policy_rule
     where status='active' and effective_from < (($1||'-01')::date + interval '1 month')
       and (effective_to is null or effective_to >= ($1||'-01')::date)
       and source_verified_at is not null and source_verified_at <= now()
       and reviewed_by is not null and approved_at is not null and approved_at <= now()
     order by id`,
    [month],
  );
  return result.rows.map((row) => {
    if (!row.source_reference.trim() || !row.code.trim())
      throw new PayrollPolicyError('rule_unavailable', row.id);
    const parsed = VerifiedPayrollRuleSchema.safeParse({
      id: row.id,
      code: row.code,
      version: row.version,
      status: row.status,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      sourceReference: row.source_reference,
      sourceVerifiedAt: row.source_verified_at.toISOString(),
      reviewedBy: row.reviewed_by,
      approvedAt: row.approved_at.toISOString(),
      config: row.config,
    });
    if (!parsed.success) throw new PayrollPolicyError('rule_unavailable', row.id);
    return parsed.data;
  });
}
