import type { OrganizationType } from '@caredesk/domain';

export interface CaseContactRow {
  roleId: string;
  contactId: string;
  fullName: string;
  title: string | null;
  roleType: string;
  isPrimary: boolean;
  isEmergency: boolean;
  organizationName: string | null;
  organizationType: string | null;
}

export interface AddContactToCaseInput {
  tenantId: string;
  employmentCaseId: string;
  contactId: string;
  roleId: string;
  fullName: string;
  title: string | null;
  preferredChannel: string | null;
  roleType: string;
  isPrimary: boolean;
  isEmergency: boolean;
  /** Either an existing organization id, or a new organization to create with it. */
  organizationId: string | null;
  newOrganization: {
    id: string;
    name: string;
    organizationType: OrganizationType;
    phone: string | null;
    email: string | null;
  } | null;
}

export interface CaseContactRepository {
  /** Creates contact (+ organization when supplied) and its case role atomically. */
  addContactToCase(input: AddContactToCaseInput): Promise<void>;
  listCaseContacts(tenantId: string, employmentCaseId: string): Promise<CaseContactRow[]>;
}
