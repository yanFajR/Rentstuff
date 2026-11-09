import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  databasePath,
  loadEnvironment,
  makePrivate,
  timestamp,
  verifyDatabase,
} from './sqlite-utils.mjs';

loadEnvironment();

const args = process.argv.slice(2);
const backupArgument = args.find((arg) => arg.startsWith('--backup='));
const confirmed = args.includes('--yes');

if (!backupArgument || !confirmed) {
  console.error(
    'Penggunaan: npm run db:restore -- --backup=/path/backup.db --yes\n' +
      'Hentikan aplikasi terlebih dahulu. Flag --yes wajib untuk mencegah restore tidak sengaja.',
  );
  process.exit(1);
}

const backupPath = resolve(backupArgument.slice('--backup='.length));
const targetPath = databasePath();

if (!existsSync(backupPath)) {
  console.error(`Backup tidak ditemukan: ${backupPath}`);
  process.exit(1);
}

const backupVerification = verifyDatabase(backupPath);
if (!backupVerification.valid) {
  console.error('Backup tidak valid; restore dibatalkan.', backupVerification);
  process.exit(1);
}

mkdirSync(dirname(targetPath), { recursive: true });
const recoveryPath = existsSync(targetPath)
  ? `${targetPath}.pre-restore-${timestamp()}`
  : null;

if (recoveryPath) {
  copyFileSync(targetPath, recoveryPath);
  makePrivate(recoveryPath);
}

rmSync(`${targetPath}-wal`, { force: true });
rmSync(`${targetPath}-shm`, { force: true });
copyFileSync(backupPath, targetPath);
makePrivate(targetPath);

const restored = verifyDatabase(targetPath);
if (!restored.valid) {
  console.error('Restore selesai tetapi database hasil restore tidak valid.', restored);
  process.exit(1);
}

const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const migration = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'status'],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  },
);

console.log(
  JSON.stringify(
    {
      status: migration.status === 0 ? 'ok' : 'warning',
      backup: backupPath,
      target: targetPath,
      recoveryCopy: recoveryPath,
      size: statSync(targetPath).size,
      integrity: restored.integrity,
      foreignKeyViolations: restored.foreignKeyViolations,
    },
    null,
    2,
  ),
);

if (migration.status !== 0) {
  process.exitCode = 1;
}
