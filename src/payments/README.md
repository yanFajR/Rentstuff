# Modul Payments

Status: **diimplementasikan pada Tahap 4**.

Fitur:

- Pencatatan pembayaran penuh dan sebagian dari detail invoice.
- Beberapa pembayaran dalam satu invoice.
- Metode `CASH`, `BANK_TRANSFER`, `E_WALLET`, `OTHER`.
- Validasi backend: integer > 0, tidak melebihi outstanding, invoice aktif dan belum lunas.
- Pencatatan dalam transaksi database; `recordedByUserId` dari session.
- Daftar dan detail pembayaran, termasuk pembayaran void.
- Void dengan alasan wajib, menyimpan waktu dan pelaku; record tidak dihapus.
- Outstanding/status invoice dihitung ulang otomatis dari pembayaran valid.

File utama:

- `payment.controller.ts` — `/payments`, `/payments/:id`, `/payments/:id/void`, dan form pembayaran pada `/invoices/:id/payments`.
- `payment.service.ts` — record/void, scoping tenant, validasi outstanding.
- `payment-method.ts` — konstanta dan label metode.
- `dto/payment-form.dto.ts` — validasi form dan void.

Nominal disimpan sebagai integer Rupiah, bukan floating point.
