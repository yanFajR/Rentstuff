import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backup } from 'node:sqlite';

import {
  backupDirectory,
  databasePath,
  ensureDirectory,
  loadEnvironment,
  makePrivate,
  openDatabase,
  sha256File,
  timestamp,
  verifyDatabase,
} from './sqlite-utils.mjs';

loadEnvironment();

const kind = (process.env.BACKUP_KIND ?? 'daily').toLowerCase();
if (!['daily', 'weekly', 'monthly'].includes(kind)) {
  console.error('BACKUP_KIND harus daily, weekly, atau monthly.');
  process.exit(1);
}

const keepDefaults = { daily: 7, weekly: 4, monthly: 3 };
const keepKey = `BACKUP_${kind.toUpperCase()}_KEEP`;
const keep = Number.parseInt(process.env[keepKey] ?? '', 10) || keepDefaults[kind];

const sourcePath = databasePath();
if (!existsSync(sourcePath)) {
  console.error(`Database tidak ditemukan: ${sourcePath}`);
  process.exit(1);
}

const directory = backupDirectory();
ensureDirectory(directory);

const stamp = timestamp();
const filename = `rental-reminder-${kind}-${stamp}.db`;
const targetPath = join(directory, filename);

const source = openDatabase(sourcePath);
try {
  await backup(source, targetPath);
} finally {
  source.close();
}
makePrivate(targetPath);

const verification = verifyDatabase(targetPath);
if (!verification.valid) {
  console.error('Backup gagal diverifikasi; backup lama tidak dihapus.', verification);
  process.exit(1);
}

const hash = sha256File(targetPath);
writeFileSync(`${targetPath}.sha256`, `${hash}  ${filename}\n`, 'utf8');
makePrivate(`${targetPath}.sha256`);

const pattern = new RegExp(`^rental-reminder-${kind}-.*\\.db$`);
const backups = readdirSync(directory)
  .filter((file) => pattern.test(file))
  .map((file) => {
    const path = join(directory, file);
    return { file, path, mtime: statSync(path).mtimeMs };
  })
  .sort((left, right) => right.mtime - left.mtime);

for (const old of backups.slice(keep)) {
  unlinkSync(old.path);
  const checksum = `${old.path}.sha256`;
  if (existsSync(checksum)) {
    unlinkSync(checksum);
  }
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      kind,
      source: sourcePath,
      backup: targetPath,
      size: verification.size,
      integrity: verification.integrity,
      foreignKeyViolations: verification.foreignKeyViolations,
      sha256: hash,
      retained: Math.min(backups.length, keep),
    },
    null,
    2,
  ),
);
