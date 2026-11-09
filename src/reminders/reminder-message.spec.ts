import { buildReminderMessage, buildWhatsAppUrl } from './reminder-message.js';

const dueDate = new Date('2026-11-15T00:00:00.000Z');

function message(): string {
  return buildReminderMessage({
    customerName: 'Budi Santoso',
    invoiceNumber: 'INV-00001',
    businessName: 'Rental Maju',
    outstanding: 1_000_000,
    dueDate,
  });
}

describe('Pesan pengingat WhatsApp', () => {
  it('menyusun pesan sopan dengan data invoice dan nominal Rupiah', () => {
    const text = message();

    expect(text).toContain('Halo Budi Santoso,');
    expect(text).toContain('invoice INV-00001 dari Rental Maju');
    expect(text).toContain('Rp1.000.000');
    expect(text).toContain('Tanggal jatuh tempo: 15 November 2026');
    expect(text).toContain('Mohon konfirmasi apabila pembayaran sudah dilakukan.');
    expect(text.trim().endsWith('Rental Maju')).toBe(true);
  });

  it('menggunakan nominal terbaru yang diberikan pemanggil', () => {
    const text = buildReminderMessage({
      customerName: 'Siti',
      invoiceNumber: 'INV-00002',
      businessName: 'Rental Kamera',
      outstanding: 250_000,
      dueDate,
    });

    expect(text).toContain('Rp250.000');
    expect(text).not.toContain('Rp1.000.000');
  });

  it('menormalisasi nomor Indonesia dan meng-encode pesan pada URL wa.me', () => {
    const text = message();
    const url = buildWhatsAppUrl('0812-3456-7890', text);

    expect(url).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
    expect(url).not.toContain('+62');
    expect(url).toContain('%0A');
    expect(url).toContain('%20');

    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe('/6281234567890');
    expect(parsed.searchParams.get('text')).toBe(text);
  });

  it('menerima nomor yang sudah berformat 62 atau internasional', () => {
    expect(buildWhatsAppUrl('6281234567890', 'Halo')).toContain('/6281234567890?');
    expect(buildWhatsAppUrl('+62 812-3456-7890', 'Halo')).toContain('/6281234567890?');
  });

  it('menolak nomor WhatsApp yang tidak valid', () => {
    expect(buildWhatsAppUrl('', message())).toBeNull();
    expect(buildWhatsAppUrl('123', message())).toBeNull();
    expect(buildWhatsAppUrl('abcdefgh', message())).toBeNull();
    expect(buildWhatsAppUrl('021-123456', message())).toBeNull();
  });
});
