import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { parseRupiahInput } from '../../common/helpers/rupiah.js';

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

export class CreateInvoiceDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Penyewaan wajib dipilih.' })
  @IsNotEmpty({ message: 'Penyewaan wajib dipilih.' })
  @IsUUID(undefined, { message: 'Penyewaan yang dipilih tidak valid.' })
  rentalRecordId = '';

  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal penerbitan tidak valid.' })
  issueDate = '';

  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal jatuh tempo tidak valid.' })
  dueDate = '';

  @Transform(({ value }) => parseRupiahInput(value))
  @IsInt({ message: 'Total tagihan harus berupa angka bulat.' })
  @Min(1, { message: 'Total tagihan harus lebih besar dari nol.' })
  @Max(2_000_000_000, { message: 'Total tagihan terlalu besar.' })
  totalAmount = 0;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Deskripsi tidak valid.' })
  @MaxLength(500, { message: 'Deskripsi maksimal 500 karakter.' })
  description?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Catatan tidak valid.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}

export class UpdateInvoiceDto {
  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal penerbitan tidak valid.' })
  issueDate = '';

  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal jatuh tempo tidak valid.' })
  dueDate = '';

  @Transform(({ value }) => parseRupiahInput(value))
  @IsInt({ message: 'Total tagihan harus berupa angka bulat.' })
  @Min(1, { message: 'Total tagihan harus lebih besar dari nol.' })
  @Max(2_000_000_000, { message: 'Total tagihan terlalu besar.' })
  totalAmount = 0;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Deskripsi tidak valid.' })
  @MaxLength(500, { message: 'Deskripsi maksimal 500 karakter.' })
  description?: string;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Catatan tidak valid.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}

export class CancelInvoiceDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Alasan pembatalan wajib diisi.' })
  @IsNotEmpty({ message: 'Alasan pembatalan wajib diisi.' })
  @MaxLength(500, { message: 'Alasan pembatalan maksimal 500 karakter.' })
  reason = '';
}
