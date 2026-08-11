const PERSON_NAME_PATTERN =
  /^[\p{L}\p{M}]+(?:[\p{L}\p{M}\p{Zs}'\u2019\u05F3\p{Pd}]*[\p{L}\p{M}])?$/u;
const ORGANIZATION_PATTERN = /^[\p{L}\p{M}\d\p{Zs}'"\u2019\u05F3\u05F4\p{Pd}()./&]+$/u;

export function isValidPersonName(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 2 && PERSON_NAME_PATTERN.test(normalized);
}

export function isValidOrganizationName(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return (
    normalized.length >= 2 && /\p{L}/u.test(normalized) && ORGANIZATION_PATTERN.test(normalized)
  );
}

export function isValidRegistrationNumber(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length >= 2 &&
    /^[\p{L}\p{N}\s./-]+$/u.test(normalized) &&
    /[\p{L}\p{N}]/u.test(normalized)
  );
}

export function phoneDigitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

export function isValidPhone(value: string): boolean {
  if (!/^[\d\s()+.-]+$/.test(value.trim())) return false;
  const count = phoneDigitCount(value);
  return count >= 9 && count <= 15;
}

export function isValidEmail(value: string): boolean {
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized);
}

export function normalizePassportNumber(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 20);
}

export function isValidPassportNumber(value: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(value.trim().toUpperCase());
}

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isPositiveMoney(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 0 && value <= 1_000_000;
}
