export function normalizeWhatsAppNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');

  if (digits.length === 0) {
    return null;
  }

  let normalized = digits;
  if (normalized.startsWith('0')) {
    normalized = `62${normalized.slice(1)}`;
  } else if (!normalized.startsWith('62')) {
    normalized = `62${normalized}`;
  }

  return /^628\d{7,11}$/.test(normalized) ? normalized : null;
}

export function formatWhatsAppNumber(value: string): string {
  const normalized = normalizeWhatsAppNumber(value);
  if (!normalized) {
    return value;
  }
  return `+${normalized}`;
}
