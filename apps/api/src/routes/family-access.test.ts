import { describe, expect, it, vi } from 'vitest';
import type {
  InMemoryActorResolver,
  MembershipAuthorizationService,
  MockAuthService,
} from '@caredesk/infrastructure';
import type { FamilyAccessResponse, FamilyMemberResponse } from '@caredesk/schemas';
import { IdentityAlreadyRegisteredError } from '../auth/supabase-invitation-service.js';
import { buildContainer, DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };

describe('/family routes', () => {
  it('enforces MFA for family administration when the rollout policy is enabled', async () => {
    const app = buildServer(loadEnv({ SENSITIVE_OPERATION_MFA_MODE: 'enforce' }));
    const response = await app.inject({
      method: 'POST',
      url: '/family/invitations',
      headers: AUTH,
      payload: { displayName: 'Family Manager', email: 'manager@example.test', role: 'manager' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'MFA_REQUIRED' });
  });

  it('lets the owner invite, change and revoke a family member', async () => {
    const app = buildServer(loadEnv({}));

    const initial = await app.inject({ method: 'GET', url: '/family/members', headers: AUTH });
    expect(initial.statusCode).toBe(200);
    expect(initial.json<FamilyAccessResponse>()).toMatchObject({
      canManage: true,
      members: [{ role: 'owner', isCurrentUser: true }],
    });

    const invited = await app.inject({
      method: 'POST',
      url: '/family/invitations',
      headers: AUTH,
      payload: { displayName: 'Family Manager', email: 'manager@example.test', role: 'manager' },
    });
    expect(invited.statusCode).toBe(201);
    const member = invited.json<FamilyMemberResponse>();
    expect(member).toMatchObject({
      displayName: 'Family Manager',
      email: 'manager@example.test',
      role: 'manager',
      status: 'invited',
      isCurrentUser: false,
    });

    const changed = await app.inject({
      method: 'PATCH',
      url: `/family/members/${member.membershipId}`,
      headers: AUTH,
      payload: { role: 'viewer' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ role: 'viewer' });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/family/members/${member.membershipId}`,
      headers: AUTH,
    });
    expect(removed.statusCode).toBe(204);

    const final = await app.inject({ method: 'GET', url: '/family/members', headers: AUTH });
    expect(final.json<FamilyAccessResponse>().members).toHaveLength(1);
  });

  it('rejects duplicate invitations and protects the owner membership', async () => {
    const app = buildServer(loadEnv({}));
    const payload = {
      displayName: 'Read Only',
      email: 'viewer@example.test',
      role: 'viewer',
    };
    expect(
      (await app.inject({ method: 'POST', url: '/family/invitations', headers: AUTH, payload }))
        .statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: '/family/invitations', headers: AUTH, payload }))
        .statusCode,
    ).toBe(409);

    const members = (
      await app.inject({ method: 'GET', url: '/family/members', headers: AUTH })
    ).json<FamilyAccessResponse>().members;
    const owner = members.find((member) => member.role === 'owner');
    expect(owner).toBeDefined();
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/family/members/${owner!.membershipId}`,
          headers: AUTH,
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('/family/invitations abuse controls', () => {
  it('rate limits invitations per owner and leaves another tenant its own budget', async () => {
    // SEC-AUTHZ-05. Every invitation sends mail and mints an identity; it was
    // the one outbound-mail write without a limiter.
    const env = loadEnv({});
    const container = buildContainer(env);
    const otherTenant = '00000000-0000-4000-8000-0000000000b1';
    const otherOwner = '00000000-0000-4000-8000-0000000000b2';
    (container.auth as MockAuthService).seedSession('other-owner-token', {
      userId: otherOwner,
      authSubject: 'other-owner-subject',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mfaSatisfied: false,
    });
    (container.actorResolver as InMemoryActorResolver).seedActor('other-owner-subject', {
      userId: otherOwner,
      tenantId: otherTenant,
    });
    (container.authorization as MembershipAuthorizationService).seedMembership({
      userId: otherOwner,
      tenantId: otherTenant,
      role: 'owner',
      status: 'active',
    });
    const app = buildServer(env, container);
    const invite = (index: number, headers = AUTH) =>
      app.inject({
        method: 'POST',
        url: '/family/invitations',
        headers,
        payload: {
          displayName: `Member ${index}`,
          email: `member-${index}@example.test`,
          role: 'viewer',
        },
      });

    for (let index = 0; index < 10; index += 1) {
      expect((await invite(index)).statusCode, `invitation ${index}`).toBe(201);
    }
    const limited = await invite(10);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    const otherTenantInvite = await invite(99, { authorization: 'Bearer other-owner-token' });
    expect(otherTenantInvite.statusCode).toBe(201);
  });

  it('returns 409 FAMILY_IDENTITY_EXISTS when the identity provider reports an existing account', async () => {
    // UI-NAV-02. Previously reported as INVITATION_DELIVERY_FAILED (502), which
    // blamed the e-mail provider for a person who already has an account.
    const env = loadEnv({});
    const container = buildContainer(env);
    vi.spyOn(container.inviteFamilyMember, 'execute').mockRejectedValue(
      new IdentityAlreadyRegisteredError(),
    );
    const app = buildServer(env, container);
    const response = await app.inject({
      method: 'POST',
      url: '/family/invitations',
      headers: AUTH,
      payload: { displayName: 'Existing Person', email: 'existing@example.test', role: 'viewer' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'FAMILY_IDENTITY_EXISTS' });
  });
});
