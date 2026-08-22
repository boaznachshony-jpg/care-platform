import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../api/client.js';
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
const key = () => crypto.randomUUID();

export function CollaborationPanel({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Collaboration | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(
    () =>
      apiRequest<Collaboration>(`/cases/${caseId}/collaboration`)
        .then(setData)
        .catch(() => setError('Collaboration could not be loaded.')),
    [caseId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <section>
        <h2>Family collaboration</h2>
        <p role="alert">{error}</p>
      </section>
    );
  if (!data) return <section aria-busy="true">Loading collaboration…</section>;
  const members = data.members.filter((m) => m.status === 'active');
  const put = async (path: string, body: unknown) => {
    setError('');
    await apiRequest(path, {
      method: 'PUT',
      headers: { 'idempotency-key': key() },
      body: JSON.stringify(body),
    });
    await load();
  };
  return (
    <section className="collaboration-panel">
      <h2>Family collaboration</h2>
      <h3>Responsibilities</h3>
      {kinds.map((kind) => (
        <label key={kind}>
          {kind.replaceAll('_', ' ')}
          <select
            aria-label={`${kind} assignee`}
            value={
              data.responsibilities.find((a) => a.responsibility === kind)
                ?.assignee_membership_id ?? ''
            }
            onChange={(e) =>
              void put(`/cases/${caseId}/responsibilities/${kind}`, {
                assigneeMembershipId: e.target.value || null,
              })
            }
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <h3>Task assignments</h3>
      {data.tasks.map((task) => (
        <label key={task.id}>
          {task.title}
          <select
            aria-label={`${task.title} assignee`}
            value={task.assignee_membership_id ?? ''}
            onChange={(e) =>
              void put(`/cases/${caseId}/tasks/${task.id}/assignee`, {
                assigneeMembershipId: e.target.value || null,
              })
            }
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <h3>Worker requests</h3>
      {data.requests.length === 0 ? (
        <p>No open requests.</p>
      ) : (
        data.requests.map((request) => (
          <article key={request.id} className="worker-card">
            <strong>{request.request_type}</strong>
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
              Status
              <select
                aria-label={`Handle ${request.request_type} request`}
                value={request.status}
                onChange={async (e) => {
                  await apiRequest(`/worker-requests/${request.id}`, {
                    method: 'PATCH',
                    headers: { 'idempotency-key': key() },
                    body: JSON.stringify({ status: e.target.value }),
                  });
                  await load();
                }}
              >
                <option value={request.status}>{request.status}</option>
                <option value="in_review">In review</option>
                <option value="approved">Accept</option>
                <option value="rejected">Reject</option>
                <option value="resolved">Resolve</option>
              </select>
            </label>
          </article>
        ))
      )}
    </section>
  );
}
