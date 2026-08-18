import type {
  AddContactToCaseInput,
  CaseContactRepository,
  CaseContactRow,
} from '@caredesk/application';

interface StoredOrganization {
  id: string;
  name: string;
  organizationType: string;
}

export class InMemoryCaseContactRepository implements CaseContactRepository {
  private readonly rowsByTenant = new Map<string, CaseContactRow[]>();
  private readonly caseByRole = new Map<string, string>();
  private readonly organizations = new Map<string, StoredOrganization>();

  async addContactToCase(input: AddContactToCaseInput): Promise<void> {
    let organization: StoredOrganization | undefined;
    if (input.newOrganization) {
      organization = {
        id: input.newOrganization.id,
        name: input.newOrganization.name,
        organizationType: input.newOrganization.organizationType,
      };
      this.organizations.set(organization.id, organization);
    } else if (input.organizationId) {
      organization = this.organizations.get(input.organizationId);
    }

    const rows = this.rowsByTenant.get(input.tenantId) ?? [];
    rows.push({
      roleId: input.roleId,
      contactId: input.contactId,
      fullName: input.fullName,
      title: input.title,
      roleType: input.roleType,
      isPrimary: input.isPrimary,
      isEmergency: input.isEmergency,
      organizationName: organization?.name ?? null,
      organizationType: organization?.organizationType ?? null,
    });
    this.rowsByTenant.set(input.tenantId, rows);
    this.caseByRole.set(input.roleId, input.employmentCaseId);
  }

  async listCaseContacts(tenantId: string, employmentCaseId: string): Promise<CaseContactRow[]> {
    return (this.rowsByTenant.get(tenantId) ?? []).filter(
      (row) => this.caseByRole.get(row.roleId) === employmentCaseId,
    );
  }
}
