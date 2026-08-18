import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { openEmploymentCaseRequestSchema, type OpenEmploymentCaseRequest } from '@caredesk/schemas';
import { Alert, Button, TextField } from '@caredesk/ui';
import { openEmploymentCase } from '../api/client.js';

/**
 * Milestone 1: opens an employment case. On failure the form data is
 * preserved (Constitution §13 — never erase a form because of a network
 * error); on success we navigate to the case view.
 */
export function OpenCasePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OpenEmploymentCaseRequest>({
    resolver: zodResolver(openEmploymentCaseRequestSchema),
  });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(false);
    try {
      const created = await openEmploymentCase(data);
      navigate(`/cases/${created.id}`);
    } catch {
      setSubmitError(true);
    }
  });

  const requiredMessage = t('case.fieldRequired');

  return (
    <div>
      <h1>{t('case.openTitle')}</h1>
      <p>{t('case.openIntro')}</p>

      {submitError ? <Alert variant="error" title={t('case.openFailed')} /> : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <fieldset>
          <legend>{t('case.sectionRecipient')}</legend>
          <TextField
            label={t('case.recipientFullName')}
            required
            error={errors.careRecipient?.fullName ? requiredMessage : undefined}
            {...register('careRecipient.fullName')}
          />
          <TextField
            label={t('case.recipientCareLevel')}
            {...register('careRecipient.careLevel')}
          />
          <TextField label={t('case.recipientCity')} {...register('careRecipient.city')} />
        </fieldset>

        <fieldset>
          <legend>{t('case.sectionEmployer')}</legend>
          <TextField
            label={t('case.employerFullName')}
            required
            error={errors.employer?.fullName ? requiredMessage : undefined}
            {...register('employer.fullName')}
          />
          <TextField
            label={t('case.employerRelationship')}
            required
            error={errors.employer?.relationshipToRecipient ? requiredMessage : undefined}
            {...register('employer.relationshipToRecipient')}
          />
          <TextField label={t('case.employerCity')} {...register('employer.city')} />
        </fieldset>

        <fieldset>
          <legend>{t('case.sectionCaregiver')}</legend>
          <TextField
            label={t('case.caregiverLegalName')}
            required
            inputDir="ltr"
            error={errors.caregiver?.legalName ? requiredMessage : undefined}
            {...register('caregiver.legalName')}
          />
          <TextField
            label={t('case.caregiverPreferredName')}
            {...register('caregiver.preferredName')}
          />
          <TextField
            label={t('case.caregiverNationality')}
            required
            error={errors.caregiver?.nationality ? requiredMessage : undefined}
            {...register('caregiver.nationality')}
          />
          <TextField
            label={t('case.caregiverLanguage')}
            {...register('caregiver.primaryLanguage')}
          />
        </fieldset>

        <TextField
          label={t('case.startDate')}
          type="date"
          required
          inputDir="ltr"
          error={errors.startDate ? requiredMessage : undefined}
          {...register('startDate')}
        />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('case.submitting') : t('case.submit')}
        </Button>
      </form>
    </div>
  );
}
