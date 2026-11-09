import { DEFAULT_TIMEZONE, formatDate, formatRupiah } from '../common/helpers/format.js';
import { normalizeWhatsAppNumber } from '../common/helpers/whatsapp.js';

export interface ReminderMessageInput {
  customerName: string;
  invoiceNumber: string;
  businessName: string;
  outstanding: number;
  dueDate: Date;
  timezone?: string;
}

export function buildReminderMessage(input: ReminderMessageInput): string {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const lines = [
    `Halo ${input.customerName},`,
    '',
    `Kami ingin mengingatkan bahwa invoice ${input.invoiceNumber} dari ${input.businessName} memiliki tagihan sebesar ${formatRupiah(input.outstanding)} yang perlu diselesaikan.`,
    '',
    `Tanggal jatuh tempo: ${formatDate(input.dueDate, timezone)}`,
    '',
    'Mohon konfirmasi apabila pembayaran sudah dilakukan.',
    '',
    'Terima kasih.',
    '',
    input.businessName,
  ];

  return lines.join('\n');
}

export function buildWhatsAppUrl(rawNumber: string, message: string): string | null {
  const normalizedNumber = normalizeWhatsAppNumber(rawNumber);
  if (!normalizedNumber) {
    return null;
  }
  return `https://wa.me/${normalizedNumber}?text=${encodeURIComponent(message)}`;
}
