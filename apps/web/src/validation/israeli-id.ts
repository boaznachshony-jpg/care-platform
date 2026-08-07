export type IsraeliIdValidationError = 'required' | 'characters' | 'length' | 'checksum';

/**
 * Converts a commonly formatted Israeli ID to the canonical nine-digit form.
 * Validation remains separate so callers do not accidentally accept letters
 * that happened to surround an otherwise valid number.
 */
export function normalizeIsraeliId(value: string): string {
  return value.replace(/\D/g, '').slice(0, 9);
}

export function getIsraeliIdValidationError(value: string): IsraeliIdValidationError | null {
  if (!value) return 'required';
  if (!/^\d+$/.test(value)) return 'characters';
  if (value.length !== 9) return 'length';

  const checksum = [...value].reduce((sum, character, index) => {
    const multiplied = Number(character) * (index % 2 === 0 ? 1 : 2);
    return sum + (multiplied > 9 ? multiplied - 9 : multiplied);
  }, 0);

  return checksum % 10 === 0 ? null : 'checksum';
}

export function isValidIsraeliId(value: string): boolean {
  return getIsraeliIdValidationError(value) === null;
}
