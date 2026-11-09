# Modul Businesses

Status: **diimplementasikan pada Tahap 2**.

Tanggung jawab:

- Halaman `/settings` untuk melihat dan mengubah profil bisnis.
- Field: nama bisnis, nama pemilik (disimpan di `users.name`), nomor WhatsApp, alamat, deskripsi.
- Normalisasi nomor WhatsApp ke format `628xx` sebelum disimpan.
- Pembaruan bisnis + nama pemilik dalam satu transaksi.
- Akses dilindungi `TenantAuthGuard`; `businessId` selalu diambil dari sesi, bukan dari request.

Rencana lanjutan (belum diminta): undangan anggota, pengelolaan peran staf, pengaturan mata uang/timezone per bisnis.
