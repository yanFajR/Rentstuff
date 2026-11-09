import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.DATABASE_URL = 'file:./test.db';

const base = resolve(process.cwd(), 'prisma', 'test.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const file = `${base}${suffix}`;
  if (existsSync(file)) {
    rmSync(file, { force: true });
  }
}

const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'reset', '--force', '--skip-generate'],
  {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
