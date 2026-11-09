import {
  BCRYPT_MAX_PASSWORD_BYTES,
  isPasswordWithinBcryptLimit,
  passwordByteLength,
} from './password.js';

describe('Password byte limits', () => {
  it('menghitung panjang UTF-8, bukan jumlah karakter', () => {
    expect(passwordByteLength('Rahasia123')).toBe(10);
    expect(passwordByteLength('é')).toBe(2);
    expect(passwordByteLength('😀')).toBe(4);
    expect(BCRYPT_MAX_PASSWORD_BYTES).toBe(72);
  });

  it('menerima password tepat 72 byte dan menolak lebih', () => {
    expect(isPasswordWithinBcryptLimit('a'.repeat(72))).toBe(true);
    expect(isPasswordWithinBcryptLimit('a'.repeat(73))).toBe(false);
    expect(isPasswordWithinBcryptLimit('é'.repeat(36))).toBe(true);
    expect(isPasswordWithinBcryptLimit('é'.repeat(37))).toBe(false);
  });
});
