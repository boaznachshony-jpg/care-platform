import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { openEmploymentCaseRequestSchema, type OpenEmploymentCaseRequest } from '@caredesk/schemas';
import { Alert, Button, TextField } from '@caredesk/ui';
import { openEmploymentCase } from '../api/client.js';
import { findCanonicalCase } from '../canonical-case.js';
import { useLegacyClientId } from '../hooks/use-legacy-client-id.js';
import { readActiveMvpProfile } from '../storage/mvp-storage.js';

/**
 * Milestone 1: opens an employment case. On failure the form data is
 * preserved (Constitution §13 — never erase a form because of a network
 * error); on success we navigate to the case view.
 *
 * Every party detail here was already given during client setup, so the form
 * opens prefilled from the stored setup profile (read synchronously, inside
 * the useState/useForm initialisers, so no field ever flashes empty). The
 * write path is unchanged: submitting still posts to the canonical case API.
 *
 * Reachability (code review WEB-11): this component used to be referenced by
 * nothing but its own test. It is now the target of `/cases/new` and
 * `/clients/:clientId/cases/new`, and case creation also runs automatically at
 * the end of onboarding — so a case created in the UI lands in the canonical
 * tables and the case, binder and visa screens stop being dead ends.
 *
 * The case it opens is linked to the active legacy client
 * (`employment_case.legacy_client_id`, migration 0042). If that client already
 * has a case, this page does not offer to create a second one: it sends the
 * user to the case they already have. The canonical row is asked first and the
 * snapshot is used only for the prefill — canonical first, snapshot as
 * fallback, never the reverse.
 */
export function OpenCasePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState(false);
  const [setupProfile] = useState(readActiveMvpProfile);
  const legacyClientId = useLegacyClientId();

  useEffect(() => {
    let cancelled = false;
    // A lookup failure is deliberately silent: the form still works, and the
    // server refuses the duplicate anyway (unique index, 0042), so an offline
    // user is not blocked from trying.
    findCanonicalCase(legacyClientId)
      .then((existing) => {
        if (!cancelled && existing) navigate(`/cases/${existing.id}`, { replace: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [legacyClientId, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OpenEmploymentCaseRequest>({
    resolver: zodResolver(openEmploymentCaseRequestSchema),
    defaultValues: {
      careRecipient: {
        fullName: setupProfile.recipientName,
        careLevel: setupProfile.recipientCareLevel,
        city: setupProfile.recipientCity,
      },
      employer: {
        fullName: setupProfile.employerName,
        relationshipToRecipient: setupProfile.employerRelationship,
        city: setupProfile.employerCity,
      },
      caregiver: {
        legalName: setupProfile.caregiverName,
        preferredName: '',
        nationality: setupProfile.caregiverCountry,
        primaryLanguage: setupProfile.caregiverLanguage,
      },
      startDate: setupProfile.employmentStartDate,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitError(false);
    try {
      // The link is added here rather than being a form field: it is provenance
      // the user has no opinion about, and sending it is what makes a retry
      // after a failed request return the same case instead of a second one.
      const created = await openEmploymentCase({ ...data, legacyClientId });
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
