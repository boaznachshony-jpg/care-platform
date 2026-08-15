import type { DocumentType } from '@caredesk/domain';

export type IntakeValidationStatus = 'valid' | 'invalid' | 'ambiguous' | 'unverified';
export type IntakeProvenance = 'ocr' | 'ai' | 'user';

export interface DocumentClassification {
  family:
    DocumentType | 'employment_authorization' | 'receipt' | 'payment_evidence' | 'unsupported';
  confidence: number;
  provenance: IntakeProvenance;
}

export interface ExtractedDocumentField {
  key: 'holder_name' | 'issue_date' | 'expiry_date';
  proposedValue: string;
  normalizedValue?: string;
  confidence: number;
  provenance: IntakeProvenance;
  validationStatus: IntakeValidationStatus;
  validationMessage?: string;
  userConfirmed: boolean;
}

export interface DocumentExtractionResult {
  classification: DocumentClassification;
  fields: ExtractedDocumentField[];
  providerRequestId?: string;
  requiresManualReview: boolean;
}

export interface DocumentIntakeProposal {
  documentId: string;
  extraction: DocumentExtractionResult;
  identityMismatch: boolean;
  reminder: { sourceRuleId: string; sourceRuleVersion: string; date: string } | null;
  state: 'ai_suggested' | 'validated' | 'user_confirmed' | 'cancelled';
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateExtractedDate(
  value: string,
  now = new Date(),
): Omit<ExtractedDocumentField, 'key' | 'confidence' | 'provenance' | 'userConfirmed'> {
  const locale = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (locale) {
    const day = Number(locale[1]);
    const month = Number(locale[2]);
    if (day <= 12 && month <= 12 && day !== month) {
      return {
        proposedValue: value,
        validationStatus: 'ambiguous',
        validationMessage: 'date_locale_ambiguous',
      };
    }
    value = `${locale[3]}-${locale[2]}-${locale[1]}`;
  }
  const match = ISO_DATE.exec(value);
  if (!match)
    return {
      proposedValue: value,
      validationStatus: 'invalid',
      validationMessage: 'date_unparseable',
    };
  const date = new Date(`${value}T00:00:00.000Z`);
  const valid =
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]);
  if (!valid)
    return {
      proposedValue: value,
      validationStatus: 'invalid',
      validationMessage: 'date_impossible',
    };
  const years = Math.abs(date.getUTCFullYear() - now.getUTCFullYear());
  if (years > 30)
    return {
      proposedValue: value,
      normalizedValue: value,
      validationStatus: 'invalid',
      validationMessage: 'date_unreasonable',
    };
  return { proposedValue: value, normalizedValue: value, validationStatus: 'valid' };
}

export function validateDateOrdering(
  fields: readonly ExtractedDocumentField[],
): ExtractedDocumentField[] {
  const issue = fields.find((field) => field.key === 'issue_date');
  const expiry = fields.find((field) => field.key === 'expiry_date');
  if (
    !issue?.normalizedValue ||
    !expiry?.normalizedValue ||
    expiry.normalizedValue >= issue.normalizedValue
  )
    return [...fields];
  return fields.map((field) =>
    field.key === 'expiry_date'
      ? { ...field, validationStatus: 'invalid', validationMessage: 'expiry_before_issue' }
      : field,
  );
}

export function buildIntakeProposal(input: {
  documentId: string;
  extraction: DocumentExtractionResult;
  canonicalName?: string;
  approvedReminder?: { ruleId: string; version: string; date: string };
}): DocumentIntakeProposal {
  const holder = input.extraction.fields.find((field) => field.key === 'holder_name');
  return {
    documentId: input.documentId,
    extraction: input.extraction,
    identityMismatch: Boolean(
      holder &&
      input.canonicalName &&
      holder.proposedValue.trim().toLocaleLowerCase() !==
        input.canonicalName.trim().toLocaleLowerCase(),
    ),
    reminder: input.approvedReminder
      ? {
          sourceRuleId: input.approvedReminder.ruleId,
          sourceRuleVersion: input.approvedReminder.version,
          date: input.approvedReminder.date,
        }
      : null,
    state: input.extraction.fields.every((field) => field.validationStatus === 'valid')
      ? 'validated'
      : 'ai_suggested',
  };
}
