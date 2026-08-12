/**
 * Error objects from auth/payment/storage providers can embed request payloads.
 * Logs retain only a bounded classification, never the message, stack, cause,
 * response body, identity, passport, bank, or document data.
 */
export function safeErrorDetails(error: unknown): {
  errorType: string;
  errorCode?: string;
  statusCode?: number;
} {
  if (!(error instanceof Error)) return { errorType: 'NonError' };
  const details: { errorType: string; errorCode?: string; statusCode?: number } = {
    errorType: error.name || 'Error',
  };
  if ('code' in error && typeof error.code === 'string')
    details.errorCode = error.code.slice(0, 80);
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    details.statusCode = error.statusCode;
  }
  return details;
}
