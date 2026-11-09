const base = process.env.PERF_BASE_URL ?? 'http://localhost:3000';
const email = process.env.PERF_EMAIL ?? 'perf.owner@example.com';
const password = process.env.PERF_PASSWORD ?? 'Rahasia123';

let cookie = '';

function updateCookie(headers) {
  const values = headers.getSetCookie?.() ?? [];
  for (const value of values) {
    const pair = value.split(';')[0];
    if (pair.startsWith('rental_reminder.sid=')) {
      cookie = pair;
    }
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      Accept: 'text/html',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  updateCookie(response.headers);
  return response;
}

function extractToken(html) {
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('Token CSRF tidak ditemukan');
  return match[1];
}

async function login() {
  const page = await request('/login');
  const html = await page.text();
  const token = extractToken(html);
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, email, password }).toString(),
  });
  if (response.status !== 303 || response.headers.get('location') !== '/dashboard') {
    throw new Error(`Login performance gagal: ${response.status}`);
  }
  await response.text();
}

async function timed(label, path) {
  const started = performance.now();
  const response = await request(path);
  const body = await response.text();
  const elapsed = performance.now() - started;
  const record = {
    label,
    path,
    status: response.status,
    milliseconds: Math.round(elapsed),
    bytes: Buffer.byteLength(body),
  };
  console.log(JSON.stringify(record));
  return record;
}

await login();
const results = [];
const pages = [
  ['Dashboard', '/dashboard'],
  ['Customers', '/customers'],
  ['Rentals', '/rentals'],
  ['Invoices', '/invoices'],
  ['Payments', '/payments'],
  ['Reminders', '/reminders'],
  ['Report summary', '/reports?tab=summary&period=this_month'],
  ['Report rentals', '/reports?tab=rentals&period=this_month'],
  ['Report invoices', '/reports?tab=invoices&period=this_month'],
  ['Report payments', '/reports?tab=payments&period=this_month'],
  ['Report receivables', '/reports?tab=receivables'],
  ['Report reminders', '/reports?tab=reminders&period=this_month'],
  ['CSV invoices', '/reports/export/invoices?period=this_month'],
  ['CSV payments', '/reports/export/payments?period=this_month'],
];

for (const [label, path] of pages) {
  results.push(await timed(label, path));
}

const concurrentStarted = performance.now();
const [dashboardResponse, exportResponse] = await Promise.all([
  request('/dashboard'),
  request('/reports/export/invoices?period=this_month'),
]);
const [dashboardBody, exportBody] = await Promise.all([
  dashboardResponse.text(),
  exportResponse.text(),
]);
const concurrentMs = Math.round(performance.now() - concurrentStarted);
results.push({
  label: 'Concurrent dashboard + CSV export',
  path: '/dashboard + /reports/export/invoices',
  status: `${dashboardResponse.status}/${exportResponse.status}`,
  milliseconds: concurrentMs,
  bytes: Buffer.byteLength(dashboardBody) + Buffer.byteLength(exportBody),
});
console.log(JSON.stringify(results[results.length - 1]));
console.log(JSON.stringify({ results }, null, 2));
