# Modul Customers

Status: **diimplementasikan pada Tahap 3**.

Fitur:

- Daftar pelanggan: pencarian nama/WhatsApp, sorting nama atau tanggal, pagination, jumlah transaksi, dan status aktif/arsip.
- Tambah dan edit pelanggan: nama & WhatsApp wajib, email/alamat/catatan opsional.
- Normalisasi WhatsApp ke `628xx` dan email ke lowercase.
- Detail pelanggan beserta seluruh riwayat transaksi.
- Arsip (soft delete) dan pulihkan pelanggan; tidak ada hard delete.
- Quick-add pelanggan via HTMX dari form transaksi (`GET/POST /customers/quick-add`).
- Semua query memakai `businessId` dari konteks autentikasi; akses lintas tenant menghasilkan 404.

File utama:

- `customer.controller.ts` — route `/customers`, `/customers/quick-add`.
- `customer.service.ts` — query ter-scope, normalisasi, arsip.
- `dto/customer-form.dto.ts` — validasi form.

Catatan: pelanggan yang diarsipkan tidak dapat diedit atau dipilih pada transaksi baru sampai dipulihkan.
