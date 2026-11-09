import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizePhoneInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const cleaned = value.replace(/[\s-]/g, '');
  return cleaned.length === 0 ? undefined : cleaned;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class UpdateBusinessDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Nama bisnis wajib diisi.' })
  @Length(2, 100, { message: 'Nama bisnis harus 2–100 karakter.' })
  businessName = '';

  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Nama pemilik wajib diisi.' })
  @Length(2, 100, { message: 'Nama pemilik harus 2–100 karakter.' })
  ownerName = '';

  @Transform(({ value }) => normalizePhoneInput(value))
  @IsOptional()
  @Matches(/^(\+?62|0)8\d{7,12}$/, {
    message: 'Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.',
  })
  whatsappNumber?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Alamat tidak valid.' })
  @MaxLength(255, { message: 'Alamat maksimal 255 karakter.' })
  address?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Deskripsi tidak valid.' })
  @MaxLength(500, { message: 'Deskripsi maksimal 500 karakter.' })
  description?: string;
}
