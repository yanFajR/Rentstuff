import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function loadEnvironment() {
  if (typeof process.loadEnvFile === 'function' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

export function databasePath() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) {
    throw new Error('DATABASE_URL harus berupa SQLite file: URL.');
  }

  const raw = url.slice('file:'.length).split('?')[0];
  if (isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    return raw;
  }
  return resolve(process.cwd(), 'prisma', raw);
}

export function openDatabase(path, readOnly = false) {
  return new DatabaseSync(path, { readOnly });
}

export function verifyDatabase(path) {
  const database = openDatabase(path, true);
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all();
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    const integrityOk =
      integrity.length === 1 && String(integrity[0].integrity_check) === 'ok';
    return {
      path,
      size: statSync(path).size,
      integrity: integrityOk ? 'ok' : integrity,
      foreignKeyViolations: foreignKeys.length,
      valid: integrityOk && foreignKeys.length === 0,
    };
  } finally {
    database.close();
  }
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows may not support POSIX permissions.
  }
}

export function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function makePrivate(path) {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not support POSIX permissions.
  }
}

export function backupDirectory() {
  return resolve(process.env.BACKUP_DIR ?? 'backups');
}
