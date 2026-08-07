export const SUPPORT_EMAIL = 'boaz.nachshony@gmail.com';

export function createSupportMailto(subject: string, body: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
