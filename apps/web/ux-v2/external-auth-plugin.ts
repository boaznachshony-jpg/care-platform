import type { Plugin } from 'vite';

/** Carry the local demo's existing auth state into this isolated build only. */
export function externalPreviewAuthPlugin(): Plugin {
  return {
    name: 'ux-v2-external-demo-session',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/auth/auth-context.tsx')) return;
      const original = 'const initialState = resolveAuthGateState(Boolean(client));';
      if (!source.includes(original)) throw new Error('Review the UX preview auth adapter.');
      return source.replace(
        original,
        "const initialState = resolveAuthGateState(Boolean(client), 'local');",
      );
    },
  };
}
