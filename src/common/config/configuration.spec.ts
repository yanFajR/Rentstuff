import configuration from './configuration.js';

describe('configuration', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('mengaktifkan secure cookie secara otomatis pada production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'x'.repeat(48);

    expect(configuration().session.cookieSecure).toBe(true);
  });

  it('menghormati override SESSION_COOKIE_SECURE=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'x'.repeat(48);
    process.env.SESSION_COOKIE_SECURE = 'false';

    expect(configuration().session.cookieSecure).toBe(false);
  });

  it('menonaktifkan secure cookie pada development', () => {
    process.env.NODE_ENV = 'development';
    process.env.SESSION_SECRET = 'x'.repeat(48);
    delete process.env.SESSION_COOKIE_SECURE;

    expect(configuration().session.cookieSecure).toBe(false);
  });

  it('mengonversi masa berlaku sesi dari jam ke milidetik', () => {
    process.env.SESSION_TTL_HOURS = '2';

    expect(configuration().session.ttlMs).toBe(2 * 60 * 60 * 1_000);
  });

  it('membaca batas rate limiting dari environment', () => {
    process.env.AUTH_LOGIN_RATE_LIMIT = '7';
    process.env.AUTH_LOGIN_RATE_WINDOW_MS = '120000';

    const config = configuration();

    expect(config.security.loginRateLimit).toBe(7);
    expect(config.security.loginRateWindowMs).toBe(120_000);
  });

  it('mengenali provider database dari DATABASE_URL', () => {
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(configuration().database.provider).toBe('sqlite');

    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/rental';
    expect(configuration().database.provider).toBe('postgresql');
  });
});
