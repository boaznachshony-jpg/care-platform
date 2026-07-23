import type { AIProvider, AIProviderRequest, AIProviderResponse } from '@caredesk/application';

/**
 * The only AIProvider enabled anywhere until ADR-003's AI Privacy Impact
 * Assessment is approved. Deterministic, scripted responses only — no
 * external call, no user data leaves the process.
 */
export class MockAIProvider implements AIProvider {
  async respond(request: AIProviderRequest): Promise<AIProviderResponse> {
    return {
      content: `[mock] No live AI provider is enabled. Purpose requested: ${request.purpose}.`,
      confidence: 'low',
      sourceLabels: ['MockAIProvider — no external source consulted'],
      disclaimer:
        'This is a scripted placeholder response, not AI-generated guidance. It is not legal, medical, or payroll advice.',
    };
  }
}
