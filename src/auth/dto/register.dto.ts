import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

import { MaxByteLength } from '../../common/validation/max-byte-length.validator.js';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeEmailInput(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class RegisterDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Nama lengkap wajib diisi.' })
  @Length(2, 100, { message: 'Nama lengkap harus 2–100 karakter.' })
  name = '';

  @Transform(({ value }) => normalizeEmailInput(value))
  @IsEmail({}, { message: 'Format email tidak valid.' })
  @MaxLength(254, { message: 'Email terlalu panjang.' })
  email = '';

  @IsString({ message: 'Kata sandi wajib diisi.' })
  @Length(8, 200, { message: 'Kata sandi harus 8–72 byte.' })
  @MaxByteLength(72, {
    message: 'Kata sandi terlalu panjang. Maksimal 72 byte UTF-8, bukan 72 karakter.',
  })
  @Matches(/[A-Za-z]/, { message: 'Kata sandi harus mengandung huruf.' })
  @Matches(/\d/, { message: 'Kata sandi harus mengandung angka.' })
  password = '';

  @IsString({ message: 'Konfirmasi kata sandi wajib diisi.' })
  @Length(8, 200, { message: 'Konfirmasi kata sandi tidak valid.' })
  @MaxByteLength(72, {
    message: 'Konfirmasi kata sandi terlalu panjang (maksimal 72 byte UTF-8).',
  })
  confirmPassword = '';

  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Nama bisnis wajib diisi.' })
  @Length(2, 100, { message: 'Nama bisnis harus 2–100 karakter.' })
  businessName = '';
}
