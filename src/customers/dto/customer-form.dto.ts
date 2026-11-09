import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizePhoneInput(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s\-().]/g, '') : value;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function normalizeEmailInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class CustomerFormDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Nama pelanggan wajib diisi.' })
  @IsNotEmpty({ message: 'Nama pelanggan wajib diisi.' })
  @Length(2, 100, { message: 'Nama pelanggan harus 2–100 karakter.' })
  name = '';

  @Transform(({ value }) => normalizePhoneInput(value))
  @IsString({ message: 'Nomor WhatsApp wajib diisi.' })
  @IsNotEmpty({ message: 'Nomor WhatsApp wajib diisi.' })
  @Matches(/^(\+?62|0)8\d{7,12}$/, {
    message: 'Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.',
  })
  whatsappNumber = '';

  @Transform(({ value }) => normalizeEmailInput(value))
  @IsOptional()
  @IsEmail({}, { message: 'Format email tidak valid.' })
  @MaxLength(254, { message: 'Email terlalu panjang.' })
  email?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Alamat tidak valid.' })
  @MaxLength(255, { message: 'Alamat maksimal 255 karakter.' })
  address?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Catatan tidak valid.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}
