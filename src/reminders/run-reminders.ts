import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { parseDateOnly } from '../common/helpers/date-only.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';

function readDateArgument(): string | undefined {
  const argument = process.argv.find((value) => value.startsWith('--date='));
  if (!argument) {
    return undefined;
  }
  const value = argument.slice('--date='.length);
  return parseDateOnly(value) ? value : undefined;
}

async function main(): Promise<void> {
  const dateArgument = process.argv.find((value) => value.startsWith('--date='));
  const todayDate = readDateArgument();

  if (dateArgument && !todayDate) {
    throw new Error('Format --date harus YYYY-MM-DD dan merupakan tanggal yang valid.');
  }

  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const scheduler = application.get(ReminderSchedulerService);
    const result = await scheduler.runOnce({ todayDate });

    process.stdout.write(
      `Scheduler pengingat ${result.todayDate}: ${result.created} dibuat, ` +
        `${result.promoted} menjadi siap, ${result.skipped} dilewati, ` +
        `${result.reactivated} diaktifkan kembali, ${result.errors} error.\n`,
    );
  } finally {
    await application.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
