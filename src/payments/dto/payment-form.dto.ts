import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { parseRupiahInput } from '../../common/helpers/rupiah.js';
import { PAYMENT_METHODS, type PaymentMethod } from '../payment-method.js';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const DATE_ONLY_INPUT = /^\d{4}-\d{2}-\d{2}$/;

export class PaymentFormDto {
  @Transform(({ value }) => parseRupiahInput(value))
  @IsInt({ message: 'Nominal pembayaran harus berupa angka bulat.' })
  @Min(1, { message: 'Nominal pembayaran harus lebih besar dari nol.' })
  @Max(2_000_000_000, { message: 'Nominal pembayaran terlalu besar.' })
  amount = 0;

  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal pembayaran tidak valid.' })
  paymentDate = '';

  @IsIn(PAYMENT_METHODS, { message: 'Metode pembayaran tidak valid.' })
  method: PaymentMethod = 'CASH';

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Referensi tidak valid.' })
  @MaxLength(100, { message: 'Referensi maksimal 100 karakter.' })
  reference?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Catatan tidak valid.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}

export class VoidPaymentDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Alasan void wajib diisi.' })
  @IsNotEmpty({ message: 'Alasan void wajib diisi.' })
  @MaxLength(500, { message: 'Alasan void maksimal 500 karakter.' })
  reason = '';
}
