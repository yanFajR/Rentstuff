import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

export class RentalFormDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Pelanggan wajib dipilih.' })
  @IsNotEmpty({ message: 'Pelanggan wajib dipilih.' })
  @IsUUID(undefined, { message: 'Pelanggan yang dipilih tidak valid.' })
  customerId = '';

  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Nama barang atau jasa wajib diisi.' })
  @IsNotEmpty({ message: 'Nama barang atau jasa wajib diisi.' })
  @Length(2, 150, { message: 'Nama barang atau jasa harus 2–150 karakter.' })
  itemName = '';

  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal mulai tidak valid.' })
  startDate = '';

  @Matches(DATE_ONLY_INPUT, { message: 'Tanggal selesai tidak valid.' })
  endDate = '';

  @Transform(({ value }) => parseRupiahInput(value))
  @IsInt({ message: 'Harga sewa harus berupa angka bulat.' })
  @Min(0, { message: 'Harga sewa tidak boleh negatif.' })
  @Max(2_000_000_000, { message: 'Harga sewa terlalu besar.' })
  price = 0;

  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString({ message: 'Catatan tidak valid.' })
  @MaxLength(1000, { message: 'Catatan maksimal 1000 karakter.' })
  notes?: string;
}
