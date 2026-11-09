const MAX_QUERY_STRING_LENGTH = 200;
const MAX_PAGE = 10_000;

export function readString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, MAX_QUERY_STRING_LENGTH);
}

export function readPage(value: unknown): number {
  const parsed = Number.parseInt(readString(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.min(parsed, MAX_PAGE);
}

export function readOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = readString(value);
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}
