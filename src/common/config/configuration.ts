export interface ApplicationSettings {
  name: string;
  version: string;
  environment: 'development' | 'test' | 'production';
  port: number;
  url: string;
  timezone: string;
}

export interface SessionSettings {
  secret: string;
  name: string;
  ttlMs: number;
  cleanupIntervalMs: number;
  cookieSecure: boolean;
}

export interface SecuritySettings {
  loginRateLimit: number;
  loginRateWindowMs: number;
  registerRateLimit: number;
  registerRateWindowMs: number;
  exportRateLimit: number;
  exportRateWindowMs: number;
  mutationRateLimit: number;
  mutationRateWindowMs: number;
}

export interface DatabaseSettings {
  provider: string;
  journalMode: string;
  busyTimeoutMs: number;
}

export interface Configuration {
  app: ApplicationSettings;
  session: SessionSettings;
  security: SecuritySettings;
  database: DatabaseSettings;
}

const HOUR_IN_MS = 60 * 60 * 1_000;

function toInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}

function resolveDatabaseProvider(url: string): string {
  if (url.startsWith('postgres')) {
    return 'postgresql';
  }
  if (url.startsWith('mysql')) {
    return 'mysql';
  }
  if (url.startsWith('file:')) {
    return 'sqlite';
  }
  return 'unknown';
}

export default (): Configuration => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const environment = (process.env.NODE_ENV ?? 'development') as ApplicationSettings['environment'];

  return {
    app: {
      name: process.env.APP_NAME?.trim() || 'Rental Reminder',
      version: process.env.npm_package_version ?? '0.1.0',
      environment,
      port: toInteger(process.env.PORT, 3000),
      url: process.env.APP_URL ?? 'http://localhost:3000',
      timezone: process.env.APP_TIMEZONE ?? 'Asia/Jakarta',
    },
    session: {
      secret: process.env.SESSION_SECRET ?? '',
      name: process.env.SESSION_NAME ?? 'rental_reminder.sid',
      ttlMs: toInteger(process.env.SESSION_TTL_HOURS, 8) * HOUR_IN_MS,
      cleanupIntervalMs: toInteger(process.env.SESSION_CLEANUP_INTERVAL_MS, HOUR_IN_MS),
      cookieSecure: toBoolean(process.env.SESSION_COOKIE_SECURE, environment === 'production'),
    },
    security: {
      loginRateLimit: toInteger(process.env.AUTH_LOGIN_RATE_LIMIT, 10),
      loginRateWindowMs: toInteger(process.env.AUTH_LOGIN_RATE_WINDOW_MS, 15 * 60 * 1_000),
      registerRateLimit: toInteger(process.env.AUTH_REGISTER_RATE_LIMIT, 10),
      registerRateWindowMs: toInteger(process.env.AUTH_REGISTER_RATE_WINDOW_MS, HOUR_IN_MS),
      exportRateLimit: toInteger(process.env.REPORT_EXPORT_RATE_LIMIT, 30),
      exportRateWindowMs: toInteger(process.env.REPORT_EXPORT_RATE_WINDOW_MS, 15 * 60 * 1_000),
      mutationRateLimit: toInteger(process.env.MUTATION_RATE_LIMIT, 300),
      mutationRateWindowMs: toInteger(process.env.MUTATION_RATE_WINDOW_MS, 5 * 60 * 1_000),
    },
    database: {
      provider: resolveDatabaseProvider(databaseUrl),
      journalMode: (process.env.SQLITE_JOURNAL_MODE ?? 'WAL').toUpperCase(),
      busyTimeoutMs: toInteger(process.env.SQLITE_BUSY_TIMEOUT_MS, 5_000),
    },
  };
};
