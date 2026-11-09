# Persiapan Migrasi PostgreSQL

Dokumen ini adalah checklist teknis untuk memindahkan database development SQLite ke PostgreSQL untuk production SaaS. **Migrasi tidak dilakukan otomatis** dan belum diuji pada tahap ini. PostgreSQL belum diinstal atau dikonfigurasi.

## 1. Prinsip yang sudah diterapkan di skema

- Primary key berupa UUID (client-generated), bukan auto-increment.
- Nama tabel eksplisit lewat `@@map` (`users`, `businesses`, `business_members`, `sessions`, `customers`, `rental_records`, `invoices`, `payments`, `reminder_jobs`, `reminder_activities`).
- Relasi memakai foreign key dengan `onDelete: Cascade`.
- Unique constraint dan index didefinisikan di level Prisma (bukan raw SQL).
- Tidak ada raw SQL di aplikasi; seluruh akses data melalui Prisma Client.
- Timestamp memakai `DateTime` (disimpan UTC), tampilan dikonversi ke `Asia/Jakarta`.
- Enum status disimpan sebagai `String` (portabel; SQLite tidak punya enum), termasuk role `OWNER`.
- Sesi disimpan server-side di tabel `sessions` (bukan MemoryStore), dengan kolom `data` berupa JSON string dan index `expiresAt`.
- Status akun memakai `users.isActive` (boolean).
- Pelanggan memakai soft delete `archivedAt`; tidak ada hard delete untuk menjaga riwayat transaksi.
- `rental_records` memakai `price` integer, `status` string, dan unique `(businessId, rentalNumber)`.
- `invoices` memakai `totalAmount` integer (snapshot), unique `(businessId, invoiceNumber)`, dan field pembatalan.
- `payments` memakai `amount` integer, metode string, `recordedByUserId`, serta field void.
- `reminder_jobs` memakai `scheduledDate` date-only, `status` string, `skipReason`, dan unique `(invoiceId, reminderType, scheduledDate)` untuk anti-duplikasi lintas instance.
- `reminder_activities` append-only dengan `userId` nullable (scheduler) dan relasi ke job; tidak ada hard delete.
- Status invoice **tidak disimpan**; dihitung dari total, pembayaran valid, due date, dan `cancelledAt`.
- Foreign key `rental_records.customerId`, `invoices.rentalRecordId`, `payments.invoiceId`, dan `reminder_jobs.invoiceId` memakai `Restrict` (tidak ada hard delete historis).
- Belum ada tipe data khusus SQLite di schema (tidak ada `@db.*`).

## 2. Perubahan schema yang diperlukan

Contoh arah perubahan `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Lalu sesuaikan per kolom:

| Area            | SQLite saat ini                                                           | Rekomendasi PostgreSQL                                                          | Catatan                                                     |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| ID              | `String @id @default(uuid())`                                             | Tambahkan `@db.Uuid`                                                            | UUID disimpan sebagai tipe native, lebih efisien            |
| Nominal uang    | `Int` (`rental_records.price`, `invoices.totalAmount`, `payments.amount`) | `BIGINT`                                                                        | Hindari float. `Int` 32-bit hanya aman sampai ~Rp2,1 miliar |
| Timestamp       | `DateTime`                                                                | `DateTime @db.Timestamptz(3)`                                                   | `timestamptz` menyimpan UTC dan aman lintas timezone        |
| Email           | `String @unique`                                                          | Tetap `String @unique`, pertimbangkan `citext` atau index `lower(email)`        | Perilaku case-sensitivity berbeda antar database            |
| Status/enum     | `String`                                                                  | `String` + check constraint, atau enum native Prisma                            | Jika enum native dipakai, perlu migrasi data eksplisit      |
| JSON            | `String` (teks JSON, dipakai `sessions.data`)                             | `TEXT` atau `jsonb` untuk data session                                          | Jika memakai `jsonb`, sesuaikan serialisasi di store        |
| Index pencarian | `@@index`                                                                 | Tetap; tambahkan index komposit `(businessId, status)`, `(businessId, dueDate)` | Sesuaikan dengan query nyata                                |

Catatan penting:

- Perbedaan case-sensitivity `LIKE`/`contains` antara SQLite dan PostgreSQL perlu diuji untuk fitur pencarian pelanggan.
- PostgreSQL meng-enforce foreign key dan unique constraint lebih ketat; data lama harus dibersihkan sebelum migrasi.
- Prisma `DateTime` di SQLite tidak menyimpan offset. Pastikan semua penulisan menggunakan UTC agar hasil konversi konsisten.
- Tabel `sessions` tidak memiliki `businessId` karena bukan data bisnis; tetap perlu dibersihkan secara berkala berdasarkan `expiresAt`.
- Hash password bcrypt tetap berupa string dan tidak berubah saat migrasi database.
- Tanggal rental adalah date-only yang disimpan UTC tengah malam. Setelah migrasi, gunakan `DATE` atau tetap `timestamptz` dengan konvensi yang sama; jangan mencampur keduanya.
- Unique `(businessId, rentalNumber)` dan index filter `(businessId, status)`, `(businessId, startDate)` harus tetap ada.
- Unique `(businessId, invoiceNumber)` serta index `(businessId, issueDate)`, `(businessId, dueDate)`, `(businessId, createdAt)` harus tetap ada.
- Index `payments` `(businessId, invoiceId)`, `(businessId, paymentDate)`, `(businessId, createdAt)` harus dipertahankan.
- Unique `(invoiceId, reminderType, scheduledDate)` serta index `(businessId, status, scheduledDate)` dan `(businessId, scheduledDate)` pada `reminder_jobs` harus dipertahankan; ini perlindungan anti-duplikasi scheduler.
- Index `reminder_activities` `(businessId, createdAt)`, `reminderId`, dan `userId` harus dipertahankan.
- `reminder_jobs.scheduledDate` adalah date-only UTC; setelah migrasi gunakan `DATE` atau `timestamptz` dengan konvensi yang sama dan uji scheduler `Asia/Jakarta`.
- Invoice snapshot tidak boleh dihitung ulang dari harga rental saat migrasi; salin `totalAmount` apa adanya.
- Status invoice dan outstanding harus dihitung ulang di aplikasi setelah migrasi; jangan membuat kolom status yang tidak sinkron.
- Pembayaran void (`voidedAt` terisi) tidak boleh dihitung sebagai pembayaran valid.
- Index pencarian pelanggan `(businessId, name)` dan `(businessId, whatsappNumber)` perlu dipertahankan; perilaku `contains` case-insensitive berbeda di PostgreSQL.

## 3. Strategi migrasi yang disarankan

1. **Bekukan skema**: selesaikan seluruh perubahan fitur sebelum migrasi production.
2. **Siapkan environment PostgreSQL** (staging) dengan versi yang sama seperti production.
3. **Buat baseline migration** untuk PostgreSQL. Jangan menggunakan ulang folder migrasi SQLite apa adanya karena SQL-nya spesifik dialek.
   - Opsi A: buat ulang migrasi dari schema PostgreSQL yang sudah disesuaikan.
   - Opsi B: `prisma migrate diff` dari schema SQLite ke PostgreSQL, tinjau manual SQL-nya.
4. **Uji di staging**:
   - Jalankan `prisma migrate deploy`.
   - Verifikasi foreign key, unique constraint, index, dan default value.
   - Jalankan seluruh unit test dan e2e test terhadap PostgreSQL.
5. **Uji perhitungan finansial** dengan data realistis: pembayaran sebagian, beberapa pembayaran, pembatalan, dan sisa tagihan.
6. **Uji scheduler reminder** dengan timezone `Asia/Jakarta` dan memastikan tidak ada duplikasi.
7. **Siapkan rollback**: backup database sebelum migrasi, dan simpan snapshot aplikasi versi lama.
8. **Cutover**: hentikan penulisan, backup, migrasi, verifikasi, lalu arahkan aplikasi ke database baru.

Jangan mengklaim migrasi berhasil sebelum seluruh langkah pengujian di atas dijalankan.

## 4. Bagian yang perlu disesuaikan saat migrasi

- `datasource.provider` dan `DATABASE_URL` (wajib `postgresql://...`).
- Anotasi `@db.Uuid` pada semua kolom ID dan foreign key.
- Tipe kolom nominal menjadi `BigInt`; sesuaikan serialisasi JSON (BigInt tidak bisa langsung di-`JSON.stringify`).
- Format tanggal/waktu pada CSV export dan tampilan tetap memakai `Asia/Jakarta`.
- Index tambahan untuk query tenant: semua tabel transaksional memakai `@@index([businessId, ...])`.
- Konfigurasi connection pool dan batas koneksi di environment production.
- Backup, monitoring, dan migrasi tanpa downtime (bila diperlukan).
- Verifikasi ulang autentikasi dan session setelah migrasi: login, logout, session fixation, dan pembersihan session kedaluwarsa.
- Pastikan `SESSION_SECRET` production berbeda dan tidak ikut berpindah bersama data session lama.

## 5. Checklist pengujian isolasi tenant (setelah Tahap 2)

- User bisnis A tidak dapat membuka detail pelanggan/tagihan milik bisnis B meski mengetahui ID-nya.
- Query list selalu terfilter `businessId` dari session, bukan dari parameter request.
- Update/delete memakai kondisi `where: { id, businessId }`.
- Request yang menyertakan `businessId`/`business_id` ditolak (sudah diuji di Tahap 2).
- User tanpa membership valid tidak dapat mengakses dashboard/pengaturan.
- Foreign key antar-tabel bisnis tidak dapat menghubungkan pelanggan bisnis A ke invoice bisnis B.
- Endpoint kesehatan dan halaman publik tidak membocorkan data tenant.
- Profil bisnis hanya dapat diubah oleh user yang menjadi anggota bisnis tersebut.
- Pelanggan dan transaksi tenant lain tidak dapat dilihat/diubah (404).
- Invoice dan pembayaran tenant lain tidak dapat dilihat/diubah/di-void (404).
- Transaksi tidak dapat memakai pelanggan dari bisnis lain atau pelanggan yang diarsipkan.
- Invoice hanya dapat memakai rental dari bisnis yang sama; payment hanya dapat memakai invoice bisnis yang sama.
- Nomor transaksi dan nomor invoice tetap unik per bisnis setelah migrasi.
- Pelanggan yang diarsipkan tetap menyimpan riwayat transaksi.
- Pembayaran void tidak dihitung; invoice cancelled tidak masuk piutang.
- Recorded/voided user tetap mengacu ke user yang benar setelah migrasi.
- Job pengingat tenant lain tidak dapat dilihat/diakses; manipulasi `reminderId` → 404.
- Unique `(invoiceId, reminderType, scheduledDate)` tetap mencegah duplikasi setelah migrasi.
- Scheduler tetap berjalan pukul 09.00 `Asia/Jakarta`; hasilnya tidak berubah karena timezone server.
- Aktivitas reminder tetap append-only dan pelakunya (`userId`) benar setelah migrasi.

## 6. Status saat ini

- Provider: SQLite (`file:./dev.db` untuk development, `file:./test.db` untuk test).
- Tahap 2 menambahkan tabel `sessions` serta kolom `users.isActive` dan `businesses.description`.
- Tahap 3 menambahkan tabel `customers` dan `rental_records` beserta index dan constraint-nya.
- Tahap 4 menambahkan tabel `invoices` dan `payments`, status turunan, serta void/cancel audit.
- Tahap 5 menambahkan tabel `reminder_jobs` dan `reminder_activities`, unique anti-duplikasi, serta index scheduler.
- Tahap 6 tidak mengubah skema; laporan memakai index tanggal/tenant yang sudah ada dan mengandalkan agregasi Prisma.
- PostgreSQL: belum diinstal, belum dikonfigurasi, belum diuji.
- Dokumen ini adalah rencana, bukan klaim bahwa migrasi sudah selesai.
