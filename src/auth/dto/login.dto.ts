import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

import { MaxByteLength } from '../../common/validation/max-byte-length.validator.js';

function normalizeEmailInput(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class LoginDto {
  @Transform(({ value }) => normalizeEmailInput(value))
  @IsEmail({}, { message: 'Format email tidak valid.' })
  @MaxLength(254, { message: 'Email terlalu panjang.' })
  email = '';

  @IsString({ message: 'Kata sandi wajib diisi.' })
  @Length(1, 200, { message: 'Kata sandi tidak valid.' })
  @MaxByteLength(72, {
    message: 'Kata sandi terlalu panjang. Maksimal 72 byte UTF-8, bukan 72 karakter.',
  })
  password = '';
}
