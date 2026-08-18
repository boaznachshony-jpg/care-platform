import { describe, expect, it } from 'vitest';
import { DenyByDefaultAuthorizationService } from './deny-by-default-authorization-service.js';

describe('DenyByDefaultAuthorizationService', () => {
  it('denies when no grant has been seeded (deny-by-default, Constitution §18)', async () => {
    const service = new DenyByDefaultAuthorizationService();

    const decision = await service.check({
      userId: 'user-1',
      tenantId: 'tenant-1',
      resourceType: 'employment_case',
      action: 'read',
    });

    expect(decision.allowed).toBe(false);
  });

  it('allows only an exact grant match, never a broader one', async () => {
    const service = new DenyByDefaultAuthorizationService();
    service.grant({
      userId: 'user-1',
      tenantId: 'tenant-1',
      resourceType: 'employment_case',
      action: 'read',
    });

    const matching = await service.check({
      userId: 'user-1',
      tenantId: 'tenant-1',
      resourceType: 'employment_case',
      action: 'read',
    });
    expect(matching.allowed).toBe(true);

    const wrongAction = await service.check({
      userId: 'user-1',
      tenantId: 'tenant-1',
      resourceType: 'employment_case',
      action: 'delete',
    });
    expect(wrongAction.allowed).toBe(false);

    const wrongTenant = await service.check({
      userId: 'user-1',
      tenantId: 'tenant-2',
      resourceType: 'employment_case',
      action: 'read',
    });
    expect(wrongTenant.allowed).toBe(false);
  });
});
