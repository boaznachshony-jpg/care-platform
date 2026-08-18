/**
 * Port for ADR-003. The caller is responsible for the minimization pipeline
 * (authorization, classification, identifier stripping, field allow-listing)
 * BEFORE building this request — this interface only carries what's already
 * been redacted, it does not redact on the provider's behalf.
 */
export interface AIProviderRequest {
  purpose: string;
  redactedContext: Record<string, unknown>;
}

export interface AIProviderResponse {
  content: string;
  confidence: 'low' | 'medium' | 'high';
  sourceLabels: string[];
  disclaimer: string;
}

export interface AIProvider {
  respond(request: AIProviderRequest): Promise<AIProviderResponse>;
}
