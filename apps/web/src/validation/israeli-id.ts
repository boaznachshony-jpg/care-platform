const ISRAELI_ID_ALLOWED_CHARACTERS = /^(?=.*\d)[\d\s-]+$/;

/**
 * Converts a commonly formatted Israeli ID to the canonical nine-digit form.
 * Validation remains separate so callers do not accidentally accept letters
 * that happened to surround an otherwise valid number.
 */
export function normalizeIsraeliId(value: string): string {
  return value.replace(/[\s-]/g, '').padStart(9, '0');
}

export function isValidIsraeliId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !ISRAELI_ID_ALLOWED_CHARACTERS.test(trimmed)) return false;

  const normalized = normalizeIsraeliId(trimmed);
  if (!/^\d{9}$/.test(normalized)) return false;

  const checksum = [...normalized].reduce((sum, character, index) => {
    const multiplied = Number(character) * (index % 2 === 0 ? 1 : 2);
    return sum + (multiplied > 9 ? multiplied - 9 : multiplied);
  }, 0);

  return checksum % 10 === 0;
}
