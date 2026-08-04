import { describe, expect, it } from 'vitest';
import type { FamilyAccessResponse, FamilyMemberResponse } from '@caredesk/schemas';
import { DEV_TOKEN } from '../container.js';
import { buildServer } from '../create-server.js';
import { loadEnv } from '../env.js';

const AUTH = { authorization: `Bearer ${DEV_TOKEN}` };

describe('/family routes', () => {
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
