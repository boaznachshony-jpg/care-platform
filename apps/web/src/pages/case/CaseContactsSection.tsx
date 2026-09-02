import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ORGANIZATION_TYPES } from '@caredesk/domain';
import type { AddContactRequest, CaseContactResponse } from '@caredesk/schemas';
import {
  Alert,
  Button,
  EmptyState,
  SelectField,
  Skeleton,
  StatusBadge,
  TextField,
} from '@caredesk/ui';
import { addCaseContact, listCaseContacts } from '../../api/client.js';
import { contactRoleOptions } from '../../contact-role-types.js';

/**
 * The form's own shape, flat, and deliberately not `addContactRequestSchema`.
 *
 * The wire schema makes `organization` an optional object whose `name` is
 * required *within* it. A registered input always yields a string, so a contact
 * with no organisation — a son, a neighbour, the family's own doctor — arrived
 * as `{ name: '', organizationType: 'nursing_office' }` and failed `min(2)`.
 * The component rendered errors only for `fullName` and `roleType`, so the
 * submit button did nothing at all and said nothing at all. Adding a family
 * member to a case was impossible, silently.
 *
 * Flattening the two organisation fields lets "no organisation" be exactly what
 * it looks like: both blank. The request object is assembled at submit time,
 * and the organisation is attached only when it was actually filled in.
 */
const contactFormSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    roleType: z.string().trim().min(2).max(60),
    title: z.string().trim().max(80).optional(),
    organizationName: z.string().trim().max(120).optional(),
    organizationType: z.enum(ORGANIZATION_TYPES).optional().or(z.literal('')),
    isPrimary: z.boolean().optional(),
    isEmergency: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // Half an organisation is worse than none: a name with no type cannot be
    // filed, and a type with no name names nothing.
    const name = value.organizationName?.trim() ?? '';
    const type = value.organizationType ?? '';
    if (name && !type) {
      ctx.addIssue({ code: 'custom', path: ['organizationType'], message: 'organization_type' });
    }
    if (!name && type) {
      ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'organization_name' });
    }
    if (name && name.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'organization_name' });
    }
  });

type ContactFormValues = z.infer<typeof contactFormSchema>;

export function CaseContactsSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<CaseContactResponse[] | null>(null);
  const [failed, setFailed] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { organizationName: '', organizationType: '' },
  });

  useEffect(() => {
    let cancelled = false;
    listCaseContacts(caseId)
      .then((rows) => {
        if (!cancelled) setContacts(rows);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const onSubmit = handleSubmit(async (values) => {
    setFailed(false);
    const organizationName = values.organizationName?.trim();
    const request: AddContactRequest = {
      fullName: values.fullName,
      roleType: values.roleType,
      ...(values.title?.trim() ? { title: values.title.trim() } : {}),
      // Attached only when both halves are present. A contact who is simply a
      // person — a son, a neighbour — is filed as one.
      ...(organizationName && values.organizationType
        ? {
            organization: {
              name: organizationName,
              organizationType: values.organizationType,
            },
          }
        : {}),
      ...(values.isPrimary ? { isPrimary: true } : {}),
      ...(values.isEmergency ? { isEmergency: true } : {}),
    };
    try {
      await addCaseContact(caseId, request);
      setContacts(await listCaseContacts(caseId));
      reset();
    } catch {
      // Form values are intentionally preserved (Constitution §13).
      setFailed(true);
    }
  });

  return (
    <section>
      <h2>{t('contacts.heading')}</h2>

      {contacts === null ? (
        <Skeleton loadingLabel={t('shell.loading')} height="1.5rem" width="14rem" />
      ) : contacts.length === 0 ? (
        <EmptyState title={t('contacts.empty')} body="" />
      ) : (
        <ul>
          {contacts.map((contact) => (
            <li key={contact.roleId}>
              <strong>{contact.fullName}</strong> — {contact.roleType}
              {contact.organizationName ? ` · ${contact.organizationName}` : ''}
              {contact.isPrimary ? (
                <StatusBadge tone="info" label={t('contacts.badgePrimary')} />
              ) : null}
              {contact.isEmergency ? (
                <StatusBadge tone="danger" label={t('contacts.badgeEmergency')} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3>{t('contacts.addHeading')}</h3>
      {failed ? <Alert variant="error" title={t('contacts.addFailed')} /> : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label={t('contacts.fullName')}
          required
          error={errors.fullName ? t('case.fieldRequired') : undefined}
          {...register('fullName')}
        />
        <SelectField
          label={t('contacts.roleType')}
          required
          placeholder={t('contacts.rolePlaceholder')}
          // The hint is not decoration: these labels name authority, and the
          // system enforces none of it. Saying so here is what keeps the list
          // from reading as a permissions grant.
          hint={t('contacts.roleTypeHint')}
          options={contactRoleOptions(t)}
          error={errors.roleType ? t('case.fieldRequired') : undefined}
          {...register('roleType')}
        />
        <TextField label={t('contacts.title')} {...register('title')} />
        <TextField
          label={t('contacts.organizationName')}
          hint={t('contacts.organizationHint')}
          error={errors.organizationName ? t('contacts.organizationNameRequired') : undefined}
          {...register('organizationName')}
        />

        <div className="cd-select-field">
          <label className="cd-select-field__label" htmlFor="organizationType">
            {t('contacts.organizationType')}
          </label>
          <select
            id="organizationType"
            className="cd-select-field__input"
            aria-invalid={errors.organizationType ? true : undefined}
            {...register('organizationType')}
          >
            {/* Empty and first, so a contact who belongs to no organisation is
                not filed as a nursing agency by default — which is what the
                previous list did to every family member added to a case. */}
            <option value="">{t('contacts.orgTypeNone')}</option>
            {ORGANIZATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`contacts.orgType.${type}`)}
              </option>
            ))}
          </select>
          {errors.organizationType ? (
            <p role="alert" className="cd-select-field__error">
              {t('contacts.organizationTypeRequired')}
            </p>
          ) : null}
        </div>

        <label>
          <input type="checkbox" {...register('isPrimary')} /> {t('contacts.isPrimary')}
        </label>
        <label>
          <input type="checkbox" {...register('isEmergency')} /> {t('contacts.isEmergency')}
        </label>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('contacts.submitting') : t('contacts.submit')}
        </Button>
      </form>
    </section>
  );
}
