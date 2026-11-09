const RUPIAH_PATTERN = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)$/;

export function parseRupiahInput(value: unknown): unknown {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  const withoutPrefix = trimmed.replace(/^rp\.?\s*/i, '');

  if (!RUPIAH_PATTERN.test(withoutPrefix)) {
    return value;
  }

  return Number(withoutPrefix.replace(/\./g, ''));
}
