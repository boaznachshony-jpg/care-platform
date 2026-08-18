import type {
  AddContactToCaseInput,
  CaseContactRepository,
  CaseContactRow,
} from '@caredesk/application';
import type { Pool } from 'pg';
import { withTenant } from './pool.js';

export class PgCaseContactRepository implements CaseContactRepository {
  constructor(private readonly pool: Pool) {}

  async addContactToCase(input: AddContactToCaseInput): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      let organizationId = input.organizationId;

      if (input.newOrganization) {
        await client.query(
          `insert into organization (id, tenant_id, name, organization_type, phone, email)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            input.newOrganization.id,
            input.tenantId,
            input.newOrganization.name,
            input.newOrganization.organizationType,
            input.newOrganization.phone,
            input.newOrganization.email,
          ],
        );
        organizationId = input.newOrganization.id;
      }

      await client.query(
        `insert into contact (id, tenant_id, organization_id, full_name, title, preferred_channel)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          input.contactId,
          input.tenantId,
          organizationId,
          input.fullName,
          input.title,
          input.preferredChannel,
        ],
      );

      await client.query(
        `insert into case_contact_role
           (id, tenant_id, employment_case_id, contact_id, role_type, is_primary, is_emergency)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.roleId,
          input.tenantId,
          input.employmentCaseId,
          input.contactId,
          input.roleType,
          input.isPrimary,
          input.isEmergency,
        ],
      );
    });
  }

  async listCaseContacts(tenantId: string, employmentCaseId: string): Promise<CaseContactRow[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<CaseContactRow>(
        `select
           r.id as "roleId",
           c.id as "contactId",
           c.full_name as "fullName",
           c.title,
           r.role_type as "roleType",
           r.is_primary as "isPrimary",
           r.is_emergency as "isEmergency",
           o.name as "organizationName",
           o.organization_type as "organizationType"
         from case_contact_role r
         join contact c on c.id = r.contact_id
         left join organization o on o.id = c.organization_id
         where r.employment_case_id = $1 and r.status = 'active'
         order by r.is_primary desc, r.created_at asc`,
        [employmentCaseId],
      );
      return result.rows;
    });
  }
}
