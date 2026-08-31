import type { CaseFoundationRepository, EmploymentCaseGraph } from '@caredesk/application';
import { brandId } from '@caredesk/domain';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

interface CaseRow {
  case_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  legacy_client_id: string | null;
  recipient_id: string;
  recipient_name: string;
  recipient_care_level: string | null;
  recipient_city: string | null;
  employer_id: string;
  employer_name: string;
  employer_relationship: string;
  employer_city: string | null;
  caregiver_id: string;
  caregiver_legal_name: string;
  caregiver_preferred_name: string | null;
  caregiver_nationality: string;
  caregiver_language: string | null;
  caregiver_status: string;
}

const SELECT_GRAPH = `
  select
    c.id as case_id, c.start_date, c.end_date, c.status, c.legacy_client_id,
    r.id as recipient_id, r.full_name as recipient_name,
    r.care_level as recipient_care_level, r.city as recipient_city,
    e.id as employer_id, e.full_name as employer_name,
    e.relationship_to_recipient as employer_relationship, e.city as employer_city,
    g.id as caregiver_id, g.legal_name as caregiver_legal_name,
    g.preferred_name as caregiver_preferred_name, g.nationality as caregiver_nationality,
    g.primary_language as caregiver_language, g.status as caregiver_status
  from employment_case c
  join care_recipient r on r.id = c.care_recipient_id
  join employer e on e.id = c.employer_id
  join caregiver g on g.id = c.caregiver_id
`;

function toGraph(row: CaseRow, tenantId: string): EmploymentCaseGraph {
  return {
    employmentCase: {
      id: brandId(row.case_id),
      tenantId: brandId(tenantId),
      careRecipientId: brandId(row.recipient_id),
      employerId: brandId(row.employer_id),
      caregiverId: brandId(row.caregiver_id),
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status as EmploymentCaseGraph['employmentCase']['status'],
      legacyClientId: row.legacy_client_id,
    },
    careRecipient: {
      id: brandId(row.recipient_id),
      tenantId: brandId(tenantId),
      fullName: row.recipient_name,
      careLevel: row.recipient_care_level,
      city: row.recipient_city,
    },
    employer: {
      id: brandId(row.employer_id),
      tenantId: brandId(tenantId),
      fullName: row.employer_name,
      relationshipToRecipient: row.employer_relationship,
      city: row.employer_city,
    },
    caregiver: {
      id: brandId(row.caregiver_id),
      tenantId: brandId(tenantId),
      legalName: row.caregiver_legal_name,
      preferredName: row.caregiver_preferred_name,
      nationality: row.caregiver_nationality,
      primaryLanguage: row.caregiver_language,
      status: row.caregiver_status === 'active' ? 'active' : 'inactive',
    },
  };
}

/**
 * Postgres-backed CaseFoundationRepository. Every operation runs inside
 * withTenant(), so RLS is active on every query — the app-level tenant
 * filter and the database policy both apply (ADR-002 defense in depth).
 */
export class PgCaseFoundationRepository implements CaseFoundationRepository {
  constructor(private readonly pool: Pool) {}

  async createCaseGraph(graph: EmploymentCaseGraph): Promise<void> {
    const tenantId = graph.employmentCase.tenantId;
    await withTenant(this.pool, tenantId, async (client) => {
      await client.query(
        `insert into care_recipient (id, tenant_id, full_name, care_level, city)
         values ($1, $2, $3, $4, $5)`,
        [
          graph.careRecipient.id,
          tenantId,
          graph.careRecipient.fullName,
          graph.careRecipient.careLevel,
          graph.careRecipient.city,
        ],
      );
      await client.query(
        `insert into employer (id, tenant_id, full_name, relationship_to_recipient, city)
         values ($1, $2, $3, $4, $5)`,
        [
          graph.employer.id,
          tenantId,
          graph.employer.fullName,
          graph.employer.relationshipToRecipient,
          graph.employer.city,
        ],
      );
      await client.query(
        `insert into caregiver (id, tenant_id, legal_name, preferred_name, nationality, primary_language, status)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          graph.caregiver.id,
          tenantId,
          graph.caregiver.legalName,
          graph.caregiver.preferredName,
          graph.caregiver.nationality,
          graph.caregiver.primaryLanguage,
          graph.caregiver.status,
        ],
      );
      await client.query(
        `insert into employment_case
           (id, tenant_id, care_recipient_id, employer_id, caregiver_id, start_date, end_date, status,
            legacy_client_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          graph.employmentCase.id,
          tenantId,
          graph.careRecipient.id,
          graph.employer.id,
          graph.caregiver.id,
          graph.employmentCase.startDate,
          graph.employmentCase.endDate,
          graph.employmentCase.status,
          graph.employmentCase.legacyClientId,
        ],
      );
    });
  }

  async findCaseGraph(tenantId: string, caseId: string): Promise<EmploymentCaseGraph | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<CaseRow>(`${SELECT_GRAPH} where c.id = $1`, [caseId]);
      const row = result.rows[0];
      return row ? toGraph(row, tenantId) : null;
    });
  }

  /**
   * Backed by the partial unique index in migration 0042, so this is at most
   * one row and the read is an index lookup rather than a scan.
   */
  async findCaseGraphByLegacyClientId(
    tenantId: string,
    legacyClientId: string,
  ): Promise<EmploymentCaseGraph | null> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<CaseRow>(`${SELECT_GRAPH} where c.legacy_client_id = $1`, [
        legacyClientId,
      ]);
      const row = result.rows[0];
      return row ? toGraph(row, tenantId) : null;
    });
  }

  async listCaseGraphs(tenantId: string): Promise<EmploymentCaseGraph[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<CaseRow>(`${SELECT_GRAPH} order by c.created_at desc`);
      return result.rows.map((row) => toGraph(row, tenantId));
    });
  }
}
