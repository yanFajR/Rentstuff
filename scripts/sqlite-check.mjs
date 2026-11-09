import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { databasePath, loadEnvironment, verifyDatabase } from './sqlite-utils.mjs';

loadEnvironment();

const argument = process.argv.slice(2).find((value) => !value.startsWith('-'));
const path = argument ? resolve(argument) : databasePath();

if (!existsSync(path)) {
  console.error(`Database tidak ditemukan: ${path}`);
  process.exit(1);
}

const result = verifyDatabase(path);
console.log(JSON.stringify(result, null, 2));

if (!result.valid) {
  process.exitCode = 1;
}
