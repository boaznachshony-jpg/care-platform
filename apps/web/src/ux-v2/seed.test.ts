// @vitest-environment-options {"url":"http://127.0.0.1:4182/clients/ux-v2-demo"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMvpClients, readMvpProfile } from '../storage/mvp-storage.js';
import { seedPreviewWorkspace } from './seed.js';
import fixture from './fixture.json';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('isolated product preview fixture', () => {
  it('round-trips through the existing encrypted product storage', () => {
    seedPreviewWorkspace();
    expect(readMvpClients()).toHaveLength(1);
    expect(readMvpProfile()).toMatchObject(fixture.profile);
    expect(localStorage.getItem('caredesk.mvp.clients.v1')).not.toContain(
      fixture.profile.recipientName,
    );
  });

  it('never replaces an existing workspace or unrelated preferences', () => {
    localStorage.setItem('caredesk.mvp.tasks.v1', 'existing-reviewer-data');
    localStorage.setItem('caredesk.ui.theme', 'dark');
    seedPreviewWorkspace();
    expect(localStorage.getItem('caredesk.mvp.tasks.v1')).toBe('existing-reviewer-data');
    expect(localStorage.getItem('caredesk.ui.theme')).toBe('dark');
    expect(localStorage.getItem('caredesk.mvp.clients.v1')).toBeNull();
  });

  it.each([
    { hostname: 'care.example.test', port: '4182' },
    { hostname: '127.0.0.1', port: '5173' },
  ])('refuses to seed outside the dedicated origin: %j', (location) => {
    vi.stubGlobal('window', { location });
    expect(() => seedPreviewWorkspace()).toThrow('loopback-only');
    expect(localStorage.length).toBe(0);
  });
});
