import Joi from 'joi';

const TIMEZONE_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/;

const timezoneSchema = Joi.string()
  .pattern(TIMEZONE_PATTERN)
  .custom((value: string, helpers) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }, 'IANA timezone')
  .default('Asia/Jakarta')
  .messages({
    'any.invalid': 'APP_TIMEZONE harus berupa zona waktu IANA yang valid.',
  });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().port().default(3000),
  APP_NAME: Joi.string().trim().min(1).max(100).default('Rental Reminder'),
  APP_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  APP_TIMEZONE: timezoneSchema,
  DATABASE_URL: Joi.string()
    .trim()
    .pattern(/^file:/)
    .required()
    .messages({
      'string.pattern.base': 'DATABASE_URL harus berupa SQLite file: URL pada Tahap 7.',
    }),
  SESSION_SECRET: Joi.string().min(32).required(),
  SESSION_NAME: Joi.string()
    .pattern(/^[A-Za-z0-9._-]+$/)
    .default('rental_reminder.sid'),
  SESSION_TTL_HOURS: Joi.number().integer().min(1).max(168).default(8),
  SESSION_CLEANUP_INTERVAL_MS: Joi.number()
    .integer()
    .min(60_000)
    .max(86_400_000)
    .default(3_600_000),
  SESSION_COOKIE_SECURE: Joi.boolean().optional(),
  AUTH_LOGIN_RATE_LIMIT: Joi.number().integer().min(1).max(10_000).default(10),
  AUTH_LOGIN_RATE_WINDOW_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(15 * 60 * 1_000),
  AUTH_REGISTER_RATE_LIMIT: Joi.number().integer().min(1).max(10_000).default(10),
  AUTH_REGISTER_RATE_WINDOW_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(60 * 60 * 1_000),
  REPORT_EXPORT_RATE_LIMIT: Joi.number().integer().min(1).max(10_000).default(30),
  REPORT_EXPORT_RATE_WINDOW_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(15 * 60 * 1_000),
  MUTATION_RATE_LIMIT: Joi.number().integer().min(1).max(100_000).default(300),
  MUTATION_RATE_WINDOW_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(5 * 60 * 1_000),
  SQLITE_JOURNAL_MODE: Joi.string()
    .valid('WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF')
    .default('WAL'),
  SQLITE_BUSY_TIMEOUT_MS: Joi.number().integer().min(0).max(60_000).default(5_000),
}).unknown(true);
