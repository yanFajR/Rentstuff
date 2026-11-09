# Modul Rentals

Status: **diimplementasikan pada Tahap 3**.

Fitur:

- Daftar transaksi: pencarian nomor/pelanggan/barang, filter status, filter rentang tanggal mulai, sorting, pagination.
- Tambah transaksi dengan pelanggan aktif dari bisnis yang sama.
- Nomor transaksi otomatis `RNT-00001` per bisnis, dijamin unik oleh constraint dan retry pada benturan.
- Detail transaksi dan edit (hanya status `ACTIVE`).
- Status `ACTIVE`, `COMPLETED`, `CANCELLED`; transisi valid hanya dari `ACTIVE` dan status final tidak dapat diubah.
- Konfirmasi sebelum menyelesaikan/membatalkan transaksi.
- Validasi tanggal, harga integer Rupiah non-negatif, dan kepemilikan pelanggan.
- Semua query memakai `businessId` dari konteks autentikasi.

File utama:

- `rental.controller.ts` — route `/rentals`.
- `rental.service.ts` — listing ter-scope, pembuatan transaksi + nomor otomatis, transisi status.
- `rental-status.ts` — konstanta, label, kelas badge, dan aturan transisi.
- `dto/rental-form.dto.ts` — validasi form dan parsing harga.

Catatan Tahap 4: setelah invoice/payment tersedia, edit transaksi juga harus diblokir jika sudah memiliki relasi finansial. Belum ada route hapus transaksi.
