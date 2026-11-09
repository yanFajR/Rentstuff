export function buildUrl(path: string, params: Record<string, unknown> = {}): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    const text = String(value).trim();
    if (text.length === 0) {
      continue;
    }
    searchParams.set(key, text);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0 ? `${path}?${queryString}` : path;
}
