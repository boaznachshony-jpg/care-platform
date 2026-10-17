import { emptyMvpProfile, replaceMvpWorkspace } from '../storage/mvp-storage.js';
import fixture from './fixture.json';

export function seedPreviewWorkspace(): void {
  // A separate origin and an empty workspace are both required. Never replace
  // existing browser data, including data created by a reviewer in this demo.
  const externalOrigins: string[] = JSON.parse(import.meta.env.VITE_UX_V2_PREVIEW_ORIGINS ?? '[]');
  const loopback =
    window.location.hostname === '127.0.0.1' && ['4182', '5182'].includes(window.location.port);
  if (!loopback && !externalOrigins.includes(window.location.origin)) {
    throw new Error('UX V2 requires its dedicated preview origin.');
  }
  if (Object.keys(localStorage).some((key) => key.startsWith('caredesk.mvp.'))) return;
  const profile = { ...emptyMvpProfile, ...fixture.profile };
  const now = new Date().toISOString();
  replaceMvpWorkspace({
    schemaVersion: 1,
    entries: {
      'caredesk.mvp.clients.v1': JSON.stringify([
        {
          id: fixture.clientId,
          label: profile.recipientName,
          employerName: profile.employerName,
          recipientName: profile.recipientName,
          caregiverName: profile.caregiverName,
          createdAt: now,
          updatedAt: now,
        },
      ]),
      [`caredesk.mvp.profile.v1.client.${fixture.clientId}`]: JSON.stringify(profile),
    },
  });
}
