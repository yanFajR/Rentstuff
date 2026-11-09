import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();
  const plainPassword = 'Rahasia123';

  it('menghasilkan hash bcrypt, bukan plaintext', async () => {
    const hash = await service.hash(plainPassword);

    expect(hash).not.toBe(plainPassword);
    expect(hash.startsWith('$2')).toBe(true);
    expect(hash.length).toBeGreaterThan(50);
  });

  it('memverifikasi kata sandi yang benar', async () => {
    const hash = await service.hash(plainPassword);

    await expect(service.verify(hash, plainPassword)).resolves.toBe(true);
  });

  it('menolak kata sandi yang salah', async () => {
    const hash = await service.hash(plainPassword);

    await expect(service.verify(hash, 'Salah123')).resolves.toBe(false);
  });

  it('menghasilkan hash berbeda untuk kata sandi yang sama (salt unik)', async () => {
    const first = await service.hash(plainPassword);
    const second = await service.hash(plainPassword);

    expect(first).not.toBe(second);
  });

  it('menjalankan timing equalizer tanpa melempar error', async () => {
    await expect(service.runTimingEqualizer('apa-saja')).resolves.toBeUndefined();
  });
});
