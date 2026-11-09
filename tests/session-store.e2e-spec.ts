import request from 'supertest';

import { SessionCleanupService } from '../src/common/session/session-cleanup.service.js';
import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createTestApplication } from './utils/create-app.js';

describe('Penyimpanan session (e2e)', () => {
  it('session tetap valid setelah aplikasi dibuat ulang dan terhapus saat logout', async () => {
    const firstApp = await createTestApplication();
    const user = await registerTestUser(firstApp.getHttpServer(), {
      businessName: 'Rental Persisten',
    });

    await testPrisma.session.create({
      data: {
        id: 'expired-session-test',
        data: '{}',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const cleanup = firstApp.get(SessionCleanupService);
    await cleanup.cleanupExpiredSessions();
    expect(
      await testPrisma.session.findUnique({ where: { id: 'expired-session-test' } }),
    ).toBeNull();
    expect(await testPrisma.session.findUnique({ where: { id: user.sessionId } })).not.toBeNull();

    await firstApp.close();

    const secondApp = await createTestApplication();
    const server = secondApp.getHttpServer() as Parameters<typeof request>[0];

    const dashboard = await request(server)
      .get('/dashboard')
      .set('Cookie', user.sessionCookie)
      .expect(200);
    expect(dashboard.text).toContain('Rental Persisten');

    const csrfToken = extractCsrfToken(dashboard.text);
    const logout = await request(server)
      .post('/logout')
      .set('Cookie', user.sessionCookie)
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(303);

    expect(logout.headers.location).toBe('/login?status=logged-out');
    expect(await testPrisma.session.findUnique({ where: { id: user.sessionId } })).toBeNull();

    await request(server)
      .get('/dashboard')
      .set('Cookie', user.sessionCookie)
      .expect(302)
      .expect('Location', '/login');

    await secondApp.close();
    await testPrisma.$disconnect();
  });
});
