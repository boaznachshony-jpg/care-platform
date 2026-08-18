import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DOCUMENT_TYPES } from '@caredesk/domain';
import {
  ALLOWED_DOCUMENT_MEDIA_TYPES,
  MAX_DOCUMENT_BYTES,
  uploadDocumentRequestSchema,
  type DocumentResponse,
  type UploadDocumentRequest,
} from '@caredesk/schemas';
import { Alert, Button, EmptyState, Skeleton, StatusBadge } from '@caredesk/ui';
import {
  getCaseDocumentDownloadUrl,
  listCaseDocuments,
  uploadCaseDocument,
} from '../../api/client.js';

function complianceTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'valid') return 'success';
  if (status === 'expiring') return 'warning';
  if (status === 'expired' || status === 'missing') return 'danger';
  return 'neutral';
}

function isAllowedMediaType(value: string): boolean {
  return (ALLOWED_DOCUMENT_MEDIA_TYPES as readonly string[]).includes(value);
}

/** Reads the picked file into base64 without ever putting its bytes in state. */
async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function CaseDocumentsSection({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<DocumentResponse[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // `content` and `mediaType` come from the file picker rather than a text
  // input, so the resolver validates only what the user actually types.
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(
      uploadDocumentRequestSchema.pick({ documentType: true, expiresOn: true }),
    ),
    defaultValues: { documentType: 'passport' },
  });

  useEffect(() => {
    let cancelled = false;
    listCaseDocuments(caseId)
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch(() => {
        if (!cancelled) setDocuments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const onSubmit = handleSubmit(async (data) => {
    setUploadFailed(false);
    setFileError(null);

    if (!file) {
      setFileError(t('documents.fileRequired'));
      return;
    }
    if (!isAllowedMediaType(file.type)) {
      setFileError(t('documents.fileTypeNotAllowed'));
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFileError(t('documents.fileTooLarge'));
      return;
    }

    try {
      await uploadCaseDocument(caseId, {
        documentType: data.documentType,
        sensitivity: 'identity_sensitive',
        mediaType: file.type as UploadDocumentRequest['mediaType'],
        content: await toBase64(file),
        expiresOn: data.expiresOn,
      });
      setDocuments(await listCaseDocuments(caseId));
      // Form values are intentionally preserved on failure (Constitution §13);
      // on success the form is cleared, including the picked file.
      reset();
      setFile(null);
    } catch {
      setUploadFailed(true);
    }
  });

  async function onOpen(documentId: string): Promise<void> {
    setDownloadFailed(false);
    setOpeningId(documentId);
    try {
      // The signed link is requested only now, and only used now — it is never
      // stored in component state or written into the DOM.
      const { url } = await getCaseDocumentDownloadUrl(caseId, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setDownloadFailed(true);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <section>
      <h2>{t('documents.heading')}</h2>
      {downloadFailed ? <Alert variant="error" title={t('documents.downloadFailed')} /> : null}

      {documents === null ? (
        <Skeleton loadingLabel={t('shell.loading')} height="1.5rem" width="14rem" />
      ) : documents.length === 0 ? (
        <EmptyState title={t('documents.empty')} body="" />
      ) : (
        <ul>
          {documents.map((document) => (
            <li key={document.id}>
              <span>{t(`documents.type.${document.documentType}`)}</span>{' '}
              <StatusBadge
                tone={complianceTone(document.complianceStatus)}
                label={t(`documents.compliance.${document.complianceStatus}`)}
              />{' '}
              <StatusBadge
                tone="neutral"
                label={t(`documents.verification.${document.verificationStatus ?? 'uploaded'}`)}
              />
              {document.expiresAt ? (
                <span>
                  {' '}
                  {t('documents.expires')}: <span dir="ltr">{document.expiresAt.slice(0, 10)}</span>
                </span>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={openingId === document.id}
                onClick={() => void onOpen(document.id)}
              >
                {openingId === document.id ? t('documents.opening') : t('documents.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <h3>{t('documents.addHeading')}</h3>
      <p>{t('documents.privacyNote')}</p>
      {uploadFailed ? <Alert variant="error" title={t('documents.uploadFailed')} /> : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="cd-text-field">
          <label className="cd-text-field__label" htmlFor="documentType">
            {t('documents.documentType')}
          </label>
          <select id="documentType" className="cd-text-field__input" {...register('documentType')}>
            {DOCUMENT_TYPES.map((documentType) => (
              <option key={documentType} value={documentType}>
                {t(`documents.type.${documentType}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="cd-text-field">
          <label className="cd-text-field__label" htmlFor="documentFile">
            {t('documents.file')}
            <span aria-hidden="true" className="cd-text-field__required">
              *
            </span>
          </label>
          <input
            id="documentFile"
            type="file"
            className="cd-text-field__input"
            accept={ALLOWED_DOCUMENT_MEDIA_TYPES.join(',')}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? 'documentFile-error' : undefined}
            onChange={(event) => {
              setFileError(null);
              setFile(event.target.files?.[0] ?? null);
            }}
          />
          {fileError ? (
            <p id="documentFile-error" role="alert" className="cd-text-field__error">
              {fileError}
            </p>
          ) : null}
        </div>

        <div className="cd-text-field">
          <label className="cd-text-field__label" htmlFor="documentExpiresOn">
            {t('documents.expiresOn')}
          </label>
          <input
            id="documentExpiresOn"
            type="date"
            dir="ltr"
            className="cd-text-field__input"
            aria-invalid={errors.expiresOn ? true : undefined}
            aria-describedby={errors.expiresOn ? 'documentExpiresOn-error' : undefined}
            {...register('expiresOn')}
          />
          {errors.expiresOn ? (
            <p id="documentExpiresOn-error" role="alert" className="cd-text-field__error">
              {t('case.fieldRequired')}
            </p>
          ) : null}
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('documents.submitting') : t('documents.submit')}
        </Button>
      </form>
    </section>
  );
}
