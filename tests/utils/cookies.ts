import request from 'supertest';

export type Agent = ReturnType<typeof request.agent>;

export function extractCsrfToken(html: string): string {
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  if (!match) {
    throw new Error('Token CSRF tidak ditemukan pada halaman.');
  }
  return match[1];
}

export async function fetchCsrfToken(agent: Agent, path: string): Promise<string> {
  const response = await agent.get(path).expect(200);
  return extractCsrfToken(response.text);
}

export function extractSessionCookie(headers: Record<string, unknown>): string {
  const setCookie = headers['set-cookie'];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === 'string'
      ? [setCookie]
      : [];
  const sessionCookie = cookies.find((cookie) => cookie.startsWith('rental_reminder.sid='));

  if (!sessionCookie) {
    throw new Error('Cookie sesi tidak ditemukan pada respons.');
  }

  return sessionCookie.split(';')[0];
}

export function sessionIdFromCookie(cookie: string): string {
  const rawValue = cookie.slice(cookie.indexOf('=') + 1);
  const decoded = decodeURIComponent(rawValue);
  const unsigned = decoded.startsWith('s:') ? decoded.slice(2) : decoded;
  return unsigned.split('.')[0] ?? '';
}

let sequence = 0;

export function uniqueEmail(prefix = 'owner'): string {
  sequence += 1;
  return `${prefix}.${Date.now()}.${sequence}@example.com`;
}
