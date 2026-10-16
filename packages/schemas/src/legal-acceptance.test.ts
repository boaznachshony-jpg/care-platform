import { describe, expect, it } from 'vitest';
import { LEGAL_ACCEPTANCE_CONTEXTS, legalAcceptanceRequestSchema } from './legal-acceptance.js';

const TERMS = { document: 'terms', version: '2026-08-31' } as const;
const PRIVACY = { document: 'privacy', version: '2026-08-31' } as const;

/**
 * GAP-5-01: an invited manager or viewer never reached the onboarding or the
 * billing screen, so nothing recorded their acceptance. The consent gate that
 * now collects it submits context 'first-visit'; before this change the schema
 * (and the 0043 check constraint) rejected that value outright.
 */
describe('legalAcceptanceRequestSchema contexts', () => {
  it('accepts every context the product collects an acceptance from', () => {
    expect([...LEGAL_ACCEPTANCE_CONTEXTS]).toEqual(['onboarding', 'billing', 'first-visit']);
    for (const context of LEGAL_ACCEPTANCE_CONTEXTS) {
      const parsed = legalAcceptanceRequestSchema.safeParse({
        documents: [TERMS, PRIVACY],
        context,
      });
      expect(parsed.success, context).toBe(true);
    }
  });

  it('still rejects a context nobody published a screen for', () => {
    const parsed = legalAcceptanceRequestSchema.safeParse({
      documents: [TERMS],
      context: 'support-chat',
    });
    expect(parsed.success).toBe(false);
  });
});
