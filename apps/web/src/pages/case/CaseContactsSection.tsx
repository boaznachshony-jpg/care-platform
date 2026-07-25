import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ORGANIZATION_TYPES } from '@caredesk/domain';
import {
  addContactRequestSchema,
  type AddContactRequest,
  type CaseContactResponse,
} from '@caredesk/schemas';
import { Alert, Button, EmptyState, Skeleton, StatusBadge, TextField } from '@caredesk/ui';
import { addCaseContact, listCaseContacts } from '../../api/client.js';

export function CaseContactsSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<CaseContactResponse[] | null>(null);
  const [failed, setFailed] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddContactRequest>({ resolver: zodResolver(addContactRequestSchema) });

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

  const onSubmit = handleSubmit(async (data) => {
    setFailed(false);
    try {
      await addCaseContact(caseId, data);
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
        <TextField
          label={t('contacts.roleType')}
          required
          error={errors.roleType ? t('case.fieldRequired') : undefined}
          {...register('roleType')}
        />
        <TextField label={t('contacts.title')} {...register('title')} />
        <TextField label={t('contacts.organizationName')} {...register('organization.name')} />

        <div className="cd-text-field">
          <label className="cd-text-field__label" htmlFor="organizationType">
            {t('contacts.organizationType')}
          </label>
          <select
            id="organizationType"
            className="cd-text-field__input"
            {...register('organization.organizationType')}
          >
            {ORGANIZATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`contacts.orgType.${type}`)}
              </option>
            ))}
          </select>
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
