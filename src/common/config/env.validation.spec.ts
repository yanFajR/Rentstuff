import { envValidationSchema } from './env.validation.js';

const SESSION_SECRET = 'a'.repeat(48);

describe('envValidationSchema', () => {
  it('menerima konfigurasi minimal dan mengisi nilai default', () => {
    const { error, value } = envValidationSchema.validate(
      {
        APP_URL: 'http://localhost:3000',
        DATABASE_URL: 'file:./dev.db',
        SESSION_SECRET,
      },
      { abortEarly: false },
    );

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.APP_TIMEZONE).toBe('Asia/Jakarta');
    expect(value.SESSION_NAME).toBe('rental_reminder.sid');
    expect(value.SESSION_TTL_HOURS).toBe(8);
    expect(value.AUTH_LOGIN_RATE_LIMIT).toBe(10);
    expect(value.AUTH_REGISTER_RATE_LIMIT).toBe(10);
  });

  it('menolak konfigurasi tanpa DATABASE_URL', () => {
    const { error } = envValidationSchema.validate(
      { APP_URL: 'http://localhost:3000', SESSION_SECRET },
      { abortEarly: false },
    );

    expect(error).toBeDefined();
  });

  it('menolak konfigurasi tanpa SESSION_SECRET', () => {
    const { error } = envValidationSchema.validate(
      { APP_URL: 'http://localhost:3000', DATABASE_URL: 'file:./dev.db' },
      { abortEarly: false },
    );

    expect(error).toBeDefined();
  });

  it('menolak SESSION_SECRET yang terlalu pendek', () => {
    const { error } = envValidationSchema.validate({
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'file:./dev.db',
      SESSION_SECRET: 'pendek',
    });

    expect(error).toBeDefined();
  });

  it('menolak PORT yang bukan angka', () => {
    const { error } = envValidationSchema.validate({
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'file:./dev.db',
      SESSION_SECRET,
      PORT: 'abc',
    });

    expect(error).toBeDefined();
  });

  it('menolak format zona waktu yang tidak valid', () => {
    const { error } = envValidationSchema.validate({
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'file:./dev.db',
      SESSION_SECRET,
      APP_TIMEZONE: 'Jakarta',
    });

    expect(error).toBeDefined();
  });

  it('menolak nama cookie sesi yang mengandung karakter tidak aman', () => {
    const { error } = envValidationSchema.validate({
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'file:./dev.db',
      SESSION_SECRET,
      SESSION_NAME: 'sesi; domain=evil',
    });

    expect(error).toBeDefined();
  });
});
