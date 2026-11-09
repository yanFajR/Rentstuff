# Skema Database

Database development memakai SQLite melalui Prisma. Dokumen ini merangkum entitas, relasi, index, dan konvensi yang berlaku setelah Tahap 6.

## 1. Konfigurasi

- `DATABASE_URL="file:./dev.db"` — path relatif dihitung dari `prisma/schema.prisma`, sehingga berada di `prisma/dev.db`.
- File test: `prisma/test.db` (dibuat ulang otomatis sebelum E2E).
- Migrasi: `prisma/migrations/` (versioned, tidak boleh dihapus).
- Tidak ada raw SQL di aplikasi; semua akses melalui Prisma Client.
- Foreign key SQLite aktif (`PRAGMA foreign_keys = 1`).

Perintah: `npm run db:migrate`, `db:deploy`, `db:studio`, `db:reset`.

## 2. Relasi utama

```text
User ──< BusinessMember >── Business
                               │
                               ├──< Customer ──< RentalRecord ──< Invoice ──< Payment
                               ├──< RentalRecord
                               ├──< Payment
                               ├──< ReminderJob ──< ReminderActivity
                               └──< ReminderActivity
```

- `Business` adalah batas tenant; semua tabel data bisnis memiliki `businessId`.
- Satu `RentalRecord` dapat memiliki banyak `Invoice`; satu `Invoice` memiliki banyak `Payment`.
- Satu `Invoice` dapat memiliki banyak `ReminderJob`; satu job memiliki banyak `ReminderActivity`.
- Satu rental dapat ditagih beberapa kali (mis. termin), masing-masing invoice menyimpan total snapshot sendiri.
- `RentalRecord.customerId` → `Restrict`; `Invoice.rentalRecordId` → `Restrict`; `Payment.invoiceId` → `Restrict`; `ReminderJob.invoiceId` → `Restrict`. Tidak ada hard delete historis.
- `Payment.recordedByUserId`, `voidedByUserId`, dan `ReminderActivity.userId` berelasi ke `User` dengan `Restrict`; activity scheduler boleh `NULL`.

## 3. Tabel

### users / businesses / business_members / sessions

Sama seperti Tahap 2 (lihat riwayat). `users.isActive`, `businesses.description`, role `OWNER`, session server-side pada `sessions.data` + `expiresAt`.

### customers

| Kolom                    | Tipe      | Keterangan          |
| ------------------------ | --------- | ------------------- |
| `id`                     | TEXT/UUID | PK                  |
| `businessId`             | TEXT      | FK businesses       |
| `name`                   | TEXT      | Wajib 2–100         |
| `whatsappNumber`         | TEXT      | Wajib, `628xx`      |
| `email`                  | TEXT?     | Opsional, lowercase |
| `address`, `notes`       | TEXT?     | Opsional            |
| `archivedAt`             | DATETIME? | Soft delete         |
| `createdAt`, `updatedAt` | DATETIME  | UTC                 |

Index: `(businessId, name)`, `(businessId, whatsappNumber)`, `(businessId, createdAt)`, `(businessId, archivedAt)`.

### rental_records

| Kolom                    | Tipe      | Keterangan                   |
| ------------------------ | --------- | ---------------------------- |
| `id`                     | TEXT/UUID | PK                           |
| `businessId`             | TEXT      | FK businesses (Cascade)      |
| `customerId`             | TEXT      | FK customers (Restrict)      |
| `rentalNumber`           | TEXT      | `RNT-00001`, unik per bisnis |
| `itemName`               | TEXT      | Barang/jasa                  |
| `startDate`, `endDate`   | DATETIME  | Date-only UTC                |
| `price`                  | INTEGER   | Rupiah                       |
| `notes`                  | TEXT?     | Opsional                     |
| `status`                 | TEXT      | ACTIVE/COMPLETED/CANCELLED   |
| `createdAt`, `updatedAt` | DATETIME  | UTC                          |

Constraint: unique `(businessId, rentalNumber)`; index `(businessId, status)`, `(businessId, createdAt)`, `(businessId, startDate)`, `customerId`.

### invoices

| Kolom                    | Tipe      | Keterangan                   |
| ------------------------ | --------- | ---------------------------- |
| `id`                     | TEXT/UUID | PK                           |
| `businessId`             | TEXT      | FK businesses (Cascade)      |
| `rentalRecordId`         | TEXT      | FK rental_records (Restrict) |
| `invoiceNumber`          | TEXT      | `INV-00001`, unik per bisnis |
| `issueDate`              | DATETIME  | Date-only UTC                |
| `dueDate`                | DATETIME  | Date-only UTC, ≥ issueDate   |
| `totalAmount`            | INTEGER   | Snapshot total Rupiah        |
| `description`            | TEXT?     | Opsional                     |
| `notes`                  | TEXT?     | Opsional                     |
| `cancelledAt`            | DATETIME? | Waktu pembatalan             |
| `cancellationReason`     | TEXT?     | Alasan pembatalan            |
| `createdAt`, `updatedAt` | DATETIME  | UTC                          |

Constraint & index:

- Unique `(businessId, invoiceNumber)`.
- `(businessId, issueDate)`, `(businessId, dueDate)`, `(businessId, createdAt)`, `(businessId, rentalRecordId)`, `rentalRecordId`.

Tidak ada kolom `status` maupun `outstanding`; keduanya dihitung dari total dan pembayaran valid.

### payments

| Kolom                    | Tipe      | Keterangan                        |
| ------------------------ | --------- | --------------------------------- |
| `id`                     | TEXT/UUID | PK                                |
| `businessId`             | TEXT      | FK businesses (Cascade)           |
| `invoiceId`              | TEXT      | FK invoices (Restrict)            |
| `amount`                 | INTEGER   | Rupiah > 0                        |
| `paymentDate`            | DATETIME  | Date-only UTC                     |
| `method`                 | TEXT      | CASH/BANK_TRANSFER/E_WALLET/OTHER |
| `reference`              | TEXT?     | Opsional                          |
| `notes`                  | TEXT?     | Opsional                          |
| `recordedByUserId`       | TEXT      | FK users (Restrict)               |
| `voidedAt`               | DATETIME? | Waktu void                        |
| `voidReason`             | TEXT?     | Alasan void                       |
| `voidedByUserId`         | TEXT?     | FK users (Restrict)               |
| `createdAt`, `updatedAt` | DATETIME  | UTC                               |

Index: `(businessId, invoiceId)`, `(businessId, paymentDate)`, `(businessId, createdAt)`, `invoiceId`, `recordedByUserId`.

### reminder_jobs

| Kolom                    | Tipe      | Keterangan                            |
| ------------------------ | --------- | ------------------------------------- |
| `id`                     | TEXT/UUID | PK                                    |
| `businessId`             | TEXT      | FK businesses (Cascade)               |
| `invoiceId`              | TEXT      | FK invoices (Restrict)                |
| `reminderType`           | TEXT      | H_MINUS_3/H_MINUS_1/DUE_DATE/H_PLUS_1 |
| `scheduledDate`          | DATETIME  | Date-only UTC untuk tanggal pengingat |
| `status`                 | TEXT      | PENDING/READY/SKIPPED                 |
| `processedAt`            | DATETIME? | Saat job menjadi READY                |
| `skippedAt`              | DATETIME? | Saat job dilewati                     |
| `skipReason`             | TEXT?     | Alasan dilewati                       |
| `createdAt`, `updatedAt` | DATETIME  | UTC                                   |

Constraint & index:

- Unique `(invoiceId, reminderType, scheduledDate)` — perlindungan anti-duplikasi di level database.
- `(businessId, status, scheduledDate)`, `(businessId, scheduledDate)`, `invoiceId`.

### reminder_activities

| Kolom          | Tipe      | Keterangan                                              |
| -------------- | --------- | ------------------------------------------------------- |
| `id`           | TEXT/UUID | PK                                                      |
| `businessId`   | TEXT      | FK businesses (Cascade)                                 |
| `reminderId`   | TEXT      | FK reminder_jobs (Restrict)                             |
| `userId`       | TEXT?     | FK users (Restrict); `NULL` untuk scheduler             |
| `activityType` | TEXT      | CREATED/SKIPPED/REACTIVATED/WHATSAPP_OPENED/MARKED_SENT |
| `notes`        | TEXT?     | Catatan opsional                                        |
| `createdAt`    | DATETIME  | Waktu aktivitas (UTC)                                   |

Index: `(businessId, createdAt)`, `reminderId`, `userId`. Tidak ada route untuk menghapus aktivitas.

## 4. Aturan data

- **Tenant**: query invoice/payment wajib memakai `businessId` session. Invoice/payment tenant lain → 404. Relasi rental/customer harus satu business.
- **Snapshot invoice**: `totalAmount` tidak pernah dihitung ulang dari harga rental. Perubahan harga rental tidak mengubah invoice.
- **Nomor invoice/rental**: dibuat otomatis per bisnis, unique, transaksi + retry saat benturan.
- **Status invoice**: dihitung backend dengan prioritas CANCELLED → PAID → OVERDUE → PARTIAL → UNPAID. Tidak disimpan agar tidak drift.
- **Outstanding**: `max(0, totalAmount - total pembayaran valid)`. Tidak ada kolom yang bisa diedit.
- **Void**: record tetap ada; `voidedAt`/`voidReason`/`voidedByUserId` diisi; pembayaran void tidak dihitung.
- **Cancel invoice**: `cancelledAt`/`cancellationReason` diisi; tidak dihitung piutang; tidak ada hard delete.
- **Reminder**: job memakai outstanding terbaru; invoice PAID/CANCELLED tidak menghasilkan job baru. Job yang sudah tidak relevan ditandai `SKIPPED` + alasan, bukan dihapus. Unique `(invoiceId, reminderType, scheduledDate)` mencegah duplikasi. Aktivitas bersifat append-only; `OPENED` tidak sama dengan `SENT`.
- **Uang**: integer Rupiah, bukan floating point; batas validasi `1..2.000.000.000` untuk invoice/payment.
- **Tanggal**: disimpan UTC midnight, ditampilkan `Asia/Jakarta`; overdue dan jadwal pengingat memakai perbandingan tanggal Jakarta.

## 5. Migrasi

1. `init_foundation` — users, businesses, business_members.
2. `auth_session_business_profile` — isActive, description, role OWNER, sessions.
3. `customers_rental_records` — customers, rental_records.
4. `invoices_payments` — invoices, payments.
5. `reminder_jobs_activities` — reminder_jobs, reminder_activities, unique anti-duplikasi dan index scheduler.

Tahap 6 tidak menambah tabel, kolom, atau migration. Laporan memakai index yang sudah ada: `(businessId, issueDate)`, `(businessId, dueDate)`, `(businessId, startDate)`, `(businessId, paymentDate)`, `(businessId, scheduledDate)`, serta relasi invoice/payment/reminder. Status dan outstanding tetap dihitung dari sumber, bukan kolom tersimpan.

Tahap 7 juga **tidak menambah migration**. Hardening dilakukan pada konfigurasi koneksi, session cleanup, backup/restore, dan query aplikasi.

## 6. SQLite production hardening

Saat startup, aplikasi SQLite menjalankan:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

- WAL meningkatkan konkurensi baca dan mengurangi konflik writer, tetapi tetap hanya untuk **satu instance** dan filesystem lokal yang mendukung locking SQLite.
- `busy_timeout` mencegah error `SQLITE_BUSY` seketika saat ada penulisan bersamaan.
- Backup memakai SQLite Online Backup API (`backup()` dari `node:sqlite`), bukan penyalinan file aktif. Restore memeriksa `integrity_check`, `foreign_key_check`, lalu menjalankan `prisma migrate status`.
- Database production harus berada di path persistent di luar source/build, misalnya `/var/lib/rental-reminder/rental.db`, dengan permission `600` untuk user aplikasi.
- Jangan meletakkan database/WAL/backup pada NFS atau filesystem jaringan yang tidak menjamin locking SQLite.
- Index Tahap 1–6 dipertahankan; tidak ada kolom status/outstanding yang didenormalisasi.

Detail operasional: [deployment.md](deployment.md) dan [backup-restore.md](backup-restore.md).

Jangan menghapus migrasi lama; buat migrasi baru untuk perubahan berikutnya.

Catatan: bila `prisma generate` gagal `EPERM ... query_engine-windows.dll.node`, hentikan proses dev/server yang mengunci engine lalu ulangi.
