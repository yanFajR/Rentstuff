import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class MarkReminderSentDto {
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Catatan tidak valid.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}
