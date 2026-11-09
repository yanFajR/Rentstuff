# Modul Invoices

Status: **diimplementasikan pada Tahap 4**.

Fitur:

- Daftar invoice: pencarian nomor/pelanggan/rental, filter status, filter tanggal terbit, sorting, pagination.
- Membuat invoice dari rental (total default dari harga rental, snapshot saat disimpan).
- Nomor otomatis `INV-00001`, unik per bisnis, transaksi database + retry saat benturan.
- Detail invoice: bisnis, pelanggan, rental, tanggal, total, pembayaran, sisa, status, riwayat pembayaran.
- Edit hanya jika belum ada pembayaran dan invoice belum lunas/dibatalkan.
- Pembatalan dengan alasan dan waktu; tidak ada hard delete.
- Status dihitung backend: CANCELLED → PAID → OVERDUE → PARTIAL → UNPAID.

File utama:

- `invoice.controller.ts` — route `/invoices` dan `/invoices/rental-summary`.
- `invoice.service.ts` — query ter-scope, penomoran, snapshot, aturan edit/cancel, agregat.
- `invoice-status.ts` — label, kelas badge, format nomor.
- `dto/invoice-form.dto.ts` — validasi form.

Catatan: invoice yang memiliki pembayaran valid harus melalui void pembayaran sebelum dapat dibatalkan. Invoice snapshot tidak berubah ketika harga rental diedit.
