import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { FamilyAccessResponse, FamilyMemberResponse } from '@caredesk/schemas';
import {
  ApiRequestError,
  inviteFamilyMember,
  listFamilyMembers,
  revokeFamilyMember,
  updateFamilyMemberRole,
} from '../api/client.js';
import { useAuth } from '../auth/auth-context.js';

type EditableRole = 'manager' | 'viewer';

export function readableFamilyMemberName(
  member: Pick<FamilyMemberResponse, 'displayName' | 'email'>,
) {
  const candidate = member.displayName.trim();
  const letters = candidate.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const suspicious = candidate.match(/[�□×]/gu)?.length ?? 0;
  if (candidate && letters >= 2 && suspicious === 0) return candidate;
  return member.email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'User';
}

export function FamilyAccessPage() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const [access, setAccess] = useState<FamilyAccessResponse | null>(null);
  const [loadingError, setLoadingError] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<EditableRole>('manager');
  const [roleDrafts, setRoleDrafts] = useState<Record<string, EditableRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    'idle' | 'sent' | 'duplicate' | 'delivery' | 'forbidden' | 'error'
  >('idle');

  async function load() {
    try {
      const result = await listFamilyMembers();
      setAccess(result);
      setRoleDrafts(
        Object.fromEntries(
          result.members
            .filter((member) => member.role !== 'owner')
            .map((member) => [member.membershipId, member.role as EditableRole]),
        ),
      );
      setLoadingError(false);
    } catch {
      setLoadingError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitInvitation(event: FormEvent) {
    event.preventDefault();
    setBusyId('invite');
    setNotice('idle');
    try {
      await inviteFamilyMember({ displayName: displayName.trim(), email: email.trim(), role });
      setDisplayName('');
      setEmail('');
      setRole('manager');
      setNotice('sent');
      await load();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'FAMILY_MEMBER_EXISTS') {
        setNotice('duplicate');
      } else if (error instanceof ApiRequestError && error.code === 'INVITATION_DELIVERY_FAILED') {
        setNotice('delivery');
      } else if (error instanceof ApiRequestError && error.code === 'FORBIDDEN') {
        setNotice('forbidden');
      } else {
        setNotice('error');
      }
    } finally {
      setBusyId(null);
    }
  }

  async function saveRole(member: FamilyMemberResponse) {
    const nextRole = roleDrafts[member.membershipId];
    if (!nextRole) return;
    setBusyId(member.membershipId);
    setNotice('idle');
    try {
      await updateFamilyMemberRole(member.membershipId, { role: nextRole });
      await load();
    } catch {
      setNotice('error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(member: FamilyMemberResponse) {
    if (
      !window.confirm(t('familyAccess.confirmRemove', { name: readableFamilyMemberName(member) }))
    )
      return;
    setBusyId(member.membershipId);
    setNotice('idle');
    try {
      await revokeFamilyMember(member.membershipId);
      await load();
    } catch {
      setNotice('error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="family-access-page" id="main-content">
      <header className="family-access-header">
        <div>
          <p className="eyebrow">{t('familyAccess.eyebrow')}</p>
          <h1>{t('familyAccess.title')}</h1>
          <p>{t('familyAccess.intro')}</p>
        </div>
        <div className="button-row">
          <Link className="secondary-button" to="/app">
            {t('familyAccess.back')}
          </Link>
          {auth.enabled ? (
            <button className="sign-out-button" type="button" onClick={() => void auth.signOut()}>
              {t('auth.signOut')}
            </button>
          ) : null}
        </div>
      </header>

      <aside className="family-access-explainer">
        <span aria-hidden="true">ⓘ</span>
        <p>{t('familyAccess.contactDisclaimer')}</p>
      </aside>

      {loadingError ? (
        <section className="card" role="alert">
          <p>{t('familyAccess.loadError')}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            {t('auth.retry')}
          </button>
        </section>
      ) : !access ? (
        <p role="status">{t('familyAccess.loading')}</p>
      ) : (
        <div className="family-access-layout">
          {access.canManage ? (
            <form
              className="card family-invite-card"
              onSubmit={(event) => void submitInvitation(event)}
            >
              <h2>{t('familyAccess.inviteTitle')}</h2>
              <p>{t('familyAccess.inviteBody')}</p>
              <label>
                {t('familyAccess.displayName')}
                <input
                  value={displayName}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                {t('familyAccess.email')}
                <input
                  dir="ltr"
                  type="email"
                  value={email}
                  required
                  maxLength={254}
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>{t('familyAccess.role')}</legend>
                {(['manager', 'viewer'] as const).map((option) => (
                  <label
                    aria-label={t(`familyAccess.roles.${option}`)}
                    className="family-role-option"
                    htmlFor={`family-role-${option}`}
                    key={option}
                  >
                    <input
                      id={`family-role-${option}`}
                      type="radio"
                      name="family-role"
                      value={option}
                      checked={role === option}
                      onChange={() => setRole(option)}
                    />
                    <span>
                      <strong>{t(`familyAccess.roles.${option}`)}</strong>
                      <small>{t(`familyAccess.roleHelp.${option}`)}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button className="primary-button" type="submit" disabled={busyId !== null}>
                {busyId === 'invite'
                  ? t('familyAccess.sendingInvite')
                  : t('familyAccess.sendInvite')}
              </button>
            </form>
          ) : (
            <aside className="card" role="note">
              {t('familyAccess.readOnlyNotice')}
            </aside>
          )}

          <section className="card family-members-card" aria-labelledby="family-members-title">
            <h2 id="family-members-title">{t('familyAccess.membersTitle')}</h2>
            <div className="family-members-list">
              {access.members.map((member) => {
                const memberName = readableFamilyMemberName(member);
                return (
                  <article className="family-member-row" key={member.membershipId}>
                    <div className="family-member-identity">
                      <span className="family-member-avatar" aria-hidden="true">
                        {memberName.slice(0, 1)}
                      </span>
                      <div>
                        <h3>
                          {memberName}{' '}
                          {member.isCurrentUser ? (
                            <small className="pill">{t('familyAccess.currentUser')}</small>
                          ) : null}
                        </h3>
                        <p dir="ltr">{member.email}</p>
                        <small>
                          {member.status === 'invited'
                            ? t('familyAccess.statusInvited')
                            : t('familyAccess.statusActive')}
                          {' · '}
                          {member.lastAuthenticatedAt
                            ? t('familyAccess.lastSeen', {
                                date: new Intl.DateTimeFormat(i18n.language, {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                }).format(new Date(member.lastAuthenticatedAt)),
                              })
                            : t('familyAccess.neverSignedIn')}
                        </small>
                      </div>
                    </div>
                    {member.role === 'owner' || !access.canManage ? (
                      <strong className="family-role-label">
                        {t(`familyAccess.roles.${member.role}`)}
                      </strong>
                    ) : (
                      <div className="family-member-actions">
                        <label>
                          <span className="sr-only">{t('familyAccess.role')}</span>
                          <select
                            value={roleDrafts[member.membershipId] ?? member.role}
                            disabled={busyId !== null}
                            onChange={(event) =>
                              setRoleDrafts((current) => ({
                                ...current,
                                [member.membershipId]: event.target.value as EditableRole,
                              }))
                            }
                          >
                            <option value="manager">{t('familyAccess.roles.manager')}</option>
                            <option value="viewer">{t('familyAccess.roles.viewer')}</option>
                          </select>
                        </label>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={
                            busyId !== null || roleDrafts[member.membershipId] === member.role
                          }
                          onClick={() => void saveRole(member)}
                        >
                          {t('familyAccess.saveRole')}
                        </button>
                        <button
                          className="danger-text-button"
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => void remove(member)}
                        >
                          {t('familyAccess.remove')}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {notice !== 'idle' ? (
        <p
          className={notice === 'sent' ? 'action-notice success' : 'action-notice error'}
          role={notice === 'sent' ? 'status' : 'alert'}
        >
          {notice === 'sent'
            ? t('familyAccess.inviteSent')
            : notice === 'duplicate'
              ? t('familyAccess.duplicateError')
              : notice === 'delivery'
                ? t('familyAccess.deliveryError')
                : notice === 'forbidden'
                  ? t('familyAccess.forbiddenError')
                  : t('familyAccess.actionError')}
        </p>
      ) : null}

      <aside className="family-ownership-notice">{t('familyAccess.ownershipNotice')}</aside>
    </main>
  );
}
