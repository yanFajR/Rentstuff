export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

export function isPasswordWithinBcryptLimit(password: string): boolean {
  return passwordByteLength(password) <= BCRYPT_MAX_PASSWORD_BYTES;
}
