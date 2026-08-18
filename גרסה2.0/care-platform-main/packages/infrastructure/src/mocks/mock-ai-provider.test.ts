import { describe, expect, it } from 'vitest';
import { MockAIProvider } from './mock-ai-provider.js';

describe('MockAIProvider', () => {
  it('always includes a disclaimer and never claims high confidence (ADR-003, Constitution §22)', async () => {
    const provider = new MockAIProvider();
    const response = await provider.respond({
      purpose: 'visa-expiry-reminder',
      redactedContext: {},
    });

    expect(response.disclaimer.length).toBeGreaterThan(0);
    expect(response.confidence).toBe('low');
    expect(response.sourceLabels.length).toBeGreaterThan(0);
  });
});
