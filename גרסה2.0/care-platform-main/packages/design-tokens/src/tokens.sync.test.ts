import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colorTokens } from './tokens.js';

describe('tokens.css / tokens.ts synchronization', () => {
  const cssPath = fileURLToPath(new URL('./tokens.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf-8');

  it('has a matching CSS custom property for every color token', () => {
    for (const [name, value] of Object.entries(colorTokens)) {
      expect(css).toContain(`--${name}: ${value};`);
    }
  });
});
