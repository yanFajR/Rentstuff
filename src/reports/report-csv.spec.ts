import type { Response } from 'express';

import {
  csvDate,
  csvDateTime,
  csvLine,
  csvNumber,
  csvText,
  streamCsv,
  toCsvCell,
} from './report-csv.js';

describe('Report CSV', () => {
  it('meng-escape koma, tanda kutip, newline, dan Unicode', () => {
    expect(csvText('Budi, Santoso')).toBe('"Budi, Santoso"');
    expect(csvText('Budi "QA"')).toBe('"Budi ""QA"""');
    expect(csvText('Baris satu\nBaris dua')).toBe('"Baris satu\nBaris dua"');
    expect(csvText('日本')).toBe('日本');
    expect(csvText(null)).toBe('');
    expect(csvText(undefined)).toBe('');
  });

  it('mencegah CSV injection untuk teks tetapi tidak mengubah angka', () => {
    expect(csvText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvText('+62')).toBe("'+62");
    expect(csvText('-100')).toBe("'-100");
    expect(csvText('@SUM')).toBe("'@SUM");
    expect(csvText('\tawal')).toBe("'\tawal");
    expect(csvNumber(-100)).toBe('-100');
    expect(csvNumber(1_500_000)).toBe('1500000');
    expect(toCsvCell(-100)).toBe('-100');
  });

  it('memformat tanggal dan waktu Jakarta secara konsisten', () => {
    const date = new Date('2026-11-14T17:30:05.000Z');
    expect(csvDate(date)).toBe('2026-11-15');
    expect(csvDateTime(date)).toBe('2026-11-15 00:30:05');
    expect(csvDate(null)).toBe('');
    expect(csvDateTime(null)).toBe('');
  });

  it('menyusun baris dengan koma dan CRLF', () => {
    expect(csvLine(['Invoice', 1_000, 'Budi, QA', '=X'])).toBe('Invoice,1000,"Budi, QA",\'=X\r\n');
  });

  it('menulis BOM, header, baris, dan filename pada stream', async () => {
    const chunks: string[] = [];
    const headers: Record<string, string> = {};
    const response = {
      status: (status: number) => {
        expect(status).toBe(200);
        return response;
      },
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: () => undefined,
    } as unknown as Response;

    async function* rows() {
      yield ['INV-00001', 1_000, 'Budi, QA'];
    }

    await streamCsv(response, {
      filename: 'laporan-invoice-2026-11-15.csv',
      header: ['Invoice', 'Nominal', 'Pelanggan'],
      rows: rows(),
    });

    expect(chunks[0]).toBe('\uFEFF');
    expect(chunks[1]).toBe('Invoice,Nominal,Pelanggan\r\n');
    expect(chunks[2]).toBe('INV-00001,1000,"Budi, QA"\r\n');
    expect(headers['Content-Type']).toContain('text/csv');
    expect(headers['Content-Disposition']).toContain('laporan-invoice-2026-11-15.csv');
  });
});
