import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../api/client.js';
import { newIdempotencyKey } from '../../api/idempotency.js';
import { formatDateTime, toIsoAttribute } from '../../format-timestamp.js';

type Member = { id: string; display_name: string; role: string; status: string };
type Assignment = { responsibility: string; assignee_membership_id: string };
type Task = { id: string; title: string; assignee_membership_id: string | null };
type Request = {
  id: string;
  request_type: string;
  message: string;
  status: string;
  assigned_membership_id: string | null;
  // Already selected by the API (wave5-service), previously dropped here - so
  // the manager read a request with no idea when the caregiver sent it.
  created_at?: string;
  updated_at?: string;
};
type Collaboration = {
  members: Member[];
  responsibilities: Assignment[];
  tasks: Task[];
  requests: Request[];
};
const kinds = [
  'case_management',
  'payroll',
  'documents_compliance',
  'visa_authorization',
  'insurance',
  'general_administration',
];
// crypto.randomUUID throws outside a secure context, and this app is
// deliberately reached over plain http on a phone at 192.168.x.x — so this
// goes through the shared fallback (uniqueness, not secrecy, is all an
// idempotency key needs). Each select's onChange is its own discrete user
// action, so a fresh key per invocation here is correct (not a "retry" of a
// prior attempt the way a form submit is).
const key = () => newIdempotencyKey();

/**
 * WEB-13: this screen was hardcoded English inside a `<html lang="he"
 * dir="rtl">` product, and the responsibility names were raw enum keys run
 * through `kind.replaceAll('_', ' ')` - "documents compliance", "visa
 * authorization". It is the one screen that says who in the family is
 * responsible for what, so it is precisely the content that has to be
 * readable by a Hebrew-speaking family member in their 50s-60s.
 *
 * Every label now comes from the `collaboration.*` namespace, and the
 * responsibility, request-type and status enums are translated through their
 * own sub-namespaces with the raw key as the fallback, so an enum value the
 * server adds later degrades to the key instead of disappearing.
 */
export function CollaborationPanel({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Collaboration | null>(null);
  const [error, setError] = useState('');
  /**
   * Kept apart from `error` on purpose (WEB-16): a failed write must not
   * replace the panel the user is working in with a load-failure screen.
   */
  const [writeError, setWriteError] = useState('');
  const load = useCallback(
    () =>
      apiRequest<Collaboration>(`/cases/${caseId}/collaboration`)
        .then((next) => {
          setData(next);
          setError('');
        })
        .catch(() => setError(t('collaboration.loadFailed'))),
    [caseId, t],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const enumLabel = (namespace: string, value: string) =>
    t(`collaboration.${namespace}.${value}`, { defaultValue: value });

  if (error)
    return (
      <section className="collaboration-panel">
        <h2>{t('collaboration.title')}</h2>
        <p role="alert">{error}</p>
        <button className="secondary-button" type="button" onClick={() => void load()}>
          {t('collaboration.retry')}
        </button>
      </section>
    );
  if (!data) return <section aria-busy="true">{t('collaboration.loading')}</section>;
  const members = data.members.filter((m) => m.status === 'active');
  /**
   * A <select> bound to a value with no matching <option> silently falls
   * back to rendering the browser's default: the FIRST option in the list.
   * `members` only has active members, but the stored
   * assignee_membership_id can point at someone who has since left — so this
   * screen used to show the wrong person as responsible with no visible
   * sign anything was off. Whenever the stored id points at an inactive (but
   * still-known) member, that member is appended to the option list and
   * labelled, so the displayed value can never diverge from the stored one.
   * (The "(לא פעיל)" suffix is a local string, not an i18n key, because
   * packages/i18n is owned by a concurrent agent; it should move there.)
   */
  const optionsFor = (selectedId: string | null | undefined): Member[] => {
    if (!selectedId || members.some((m) => m.id === selectedId)) return members;
    const assigned = data.members.find((m) => m.id === selectedId);
    return assigned ? [...members, assigned] : members;
  };
  const memberOptionLabel = (member: Member): string =>
    member.status === 'active' ? member.display_name : `${member.display_name} (לא פעיל)`;
  const put = async (path: string, body: unknown) => {
    setWriteError('');
    await apiRequest(path, {
      method: 'PUT',
      headers: { 'idempotency-key': key() },
      body: JSON.stringify(body),
    });
    await load();
  };
  /**
   * A failed PUT/PATCH used to make the `<select>` snap back to its old value
   * with no message at all, which reads as "the app ignored my click". The
   * message is separate from the load error above so a failed write never
   * replaces the panel the user is working in (WEB-16 shape).
   */
  const runWrite = (work: Promise<unknown>) => {
    void work.catch(() => setWriteError(t('collaboration.saveFailed')));
  };
  return (
    <section className="collaboration-panel">
      <h2>{t('collaboration.title')}</h2>
      {writeError ? <p role="alert">{writeError}</p> : null}
      <h3>{t('collaboration.responsibilities')}</h3>
      {kinds.map((kind) => {
        const assigneeId =
          data.responsibilities.find((a) => a.responsibility === kind)?.assignee_membership_id ??
          '';
        return (
          <label key={kind}>
            {enumLabel('responsibility', kind)}
            <select
              aria-label={t('collaboration.assigneeLabel', {
                subject: enumLabel('responsibility', kind),
              })}
              value={assigneeId}
              onChange={(e) =>
                runWrite(
                  put(`/cases/${caseId}/responsibilities/${kind}`, {
                    assigneeMembershipId: e.target.value || null,
                  }),
                )
              }
            >
              <option value="">{t('collaboration.unassigned')}</option>
              {optionsFor(assigneeId).map((m) => (
                <option key={m.id} value={m.id}>
                  {memberOptionLabel(m)}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <h3>{t('collaboration.taskAssignments')}</h3>
      {data.tasks.map((task) => (
        <label key={task.id}>
          {task.title}
          <select
            aria-label={t('collaboration.assigneeLabel', { subject: task.title })}
            value={task.assignee_membership_id ?? ''}
            onChange={(e) =>
              runWrite(
                put(`/cases/${caseId}/tasks/${task.id}/assignee`, {
                  assigneeMembershipId: e.target.value || null,
                }),
              )
            }
          >
            <option value="">{t('collaboration.unassigned')}</option>
            {optionsFor(task.assignee_membership_id).map((m) => (
              <option key={m.id} value={m.id}>
                {memberOptionLabel(m)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <h3>{t('collaboration.workerRequests')}</h3>
      {data.requests.length === 0 ? (
        <p>{t('collaboration.noRequests')}</p>
      ) : (
        data.requests.map((request) => (
          <article key={request.id} className="worker-card">
            <strong>{enumLabel('requestType', request.request_type)}</strong>
            {/* Worker requests are always authored by the caregiver - the
                table has no other author - so the side is stated plainly
                rather than left for the reader to infer. */}
            <p className="thread-author">{t('collaboration.fromCaregiver')}</p>
            <p>{request.message}</p>
            <small className="record-timestamp">
              {toIsoAttribute(request.created_at) ? (
                <>
                  {t('collaboration.receivedAt')}{' '}
                  <time dateTime={toIsoAttribute(request.created_at) ?? undefined}>
                    {formatDateTime(request.created_at)}
                  </time>
                </>
              ) : null}
              {toIsoAttribute(request.updated_at) && request.updated_at !== request.created_at ? (
                <>
                  {' · '}
                  {t('collaboration.handledAt')}{' '}
                  <time dateTime={toIsoAttribute(request.updated_at) ?? undefined}>
                    {formatDateTime(request.updated_at)}
                  </time>
                </>
              ) : null}
            </small>
            <label>
              {t('collaboration.statusLabel')}
              <select
                aria-label={t('collaboration.handleRequestLabel', {
                  subject: enumLabel('requestType', request.request_type),
                })}
                value={request.status}
                onChange={(e) =>
                  runWrite(
                    apiRequest(`/worker-requests/${request.id}`, {
                      method: 'PATCH',
                      headers: { 'idempotency-key': key() },
                      body: JSON.stringify({ status: e.target.value }),
                    }).then(() => load()),
                  )
                }
              >
                <option value={request.status}>{enumLabel('status', request.status)}</option>
                {['in_review', 'approved', 'rejected', 'resolved']
                  .filter((status) => status !== request.status)
                  .map((status) => (
                    <option key={status} value={status}>
                      {enumLabel('status', status)}
                    </option>
                  ))}
              </select>
            </label>
          </article>
        ))
      )}
    </section>
  );
}
