# Arsitektur & Keputusan Teknis

Dokumen ini menjelaskan arsitektur aplikasi setelah Tahap 6, keputusan teknis penting, konvensi data, dan hal yang sengaja ditunda.

## 1. Modular monolith, satu aplikasi, satu deployment

Aplikasi terdiri dari satu project NestJS yang menyajikan HTML server-side dan endpoint JSON (health check). Tidak ada frontend framework terpisah, microservice, atau worker terpisah.

- Satu proses dan satu database menyederhanakan deployment.
- SSR + HTMX cukup untuk form, pencarian, filter, pagination, dan polling status.
- Batas modul jelas di level kode.

Modul aktif: `auth`, `businesses`, `customers`, `rentals`, `invoices`, `payments`, `reminders`, `reports`, `dashboard`, `common`, `health`.

## 2. Alur request

```text
Request
  → Helmet & static assets
  → SessionMiddleware (express-session + Prisma store)
  → RequestLoggerMiddleware
  → ViewLocalsMiddleware (flash, CSRF token, helper format/URL/status)
  → Rate limiter (khusus POST /login dan /register)
  → Controller
      → CsrfGuard global (method non-GET)
      → TenantAuthGuard (semua halaman bisnis)
          → validasi session + membership ke database
          → tolak businessId dari request
      → Service / PrismaService (query terfilter businessId)
      → response.render('view', data)
  → AllExceptionsFilter
```

`ViewLocalsMiddleware` menyediakan helper format Rupiah/tanggal, label & kelas status rental/invoice/pengingat, label metode pembayaran, helper URL pagination, token CSRF, dan flash. Halaman bersesi memakai `Cache-Control: no-store`. Token CSRF tidak dibuat untuk `/health`, `/assets`, dan `/vendor`.

## 3. ESM dan versi library

NestJS 12 adalah paket ESM murni, sehingga project memakai `"type": "module"` dan `nodenext`. Import relatif wajib `.js`, `__dirname` diganti `import.meta.url`, dan Jest berjalan mode ESM dengan mapping `.js` → `.ts`.

Dependency dipilih yang kompatibel ESM: `express-session` + store Prisma kustom, `bcryptjs`, `express-rate-limit`, `@nestjs/schedule`. `@nestjs/throttler` tidak dipakai karena versi stabilnya CJS dan gagal di runtime Jest ESM. Prisma 6.19.3, TypeScript 6.0.3.

## 4. Rendering, HTMX, dan UI

- View EJS di `src/views`, disalin ke `dist/views` saat build.
- HTMX disajikan dari `/vendor/htmx`; Tailwind CSS 4 dibangun ke `public/css/app.css`.
- Tanpa inline script/style; modal, konfirmasi, dan loading tombol memakai `public/js/app.js`.
- HTMX dipakai untuk pencarian/filter daftar (`hx-select`), quick-add pelanggan (OOB swap), dan form invoice: memilih rental memuat ringkasan + total default melalui `GET /invoices/rental-summary`.

## 5. Autentikasi & session

Register membuat user, business, dan membership `OWNER` dalam satu transaksi, password bcrypt cost 12, email dinormalisasi, lalu auto-login. Login memakai pesan gagal generik, timing equalizer untuk email tidak dikenal, menolak akun nonaktif, dan meregenerasi session (anti session fixation). Logout menghapus session dari store dan cookie.

Session server-side di tabel `sessions` via `PrismaSessionStore` (bukan MemoryStore), cookie `HttpOnly` + `SameSite=Lax` + `Secure` di production, TTL default 8 jam dengan rolling.

## 6. CSRF, rate limiting, validasi

- CSRF token 32 byte di session, hidden `_csrf`, `CsrfGuard` global, `timingSafeEqual`, 403.
- Rate limit login 10 gagal/15 menit per IP, register 10/jam per IP; 429.
- Form divalidasi `FormValidationService`; error per field dan nilai form dipertahankan.
- Error 500 tidak membocorkan stack trace di production.

## 7. Customer Management

- Daftar/cari/sort/pagination, detail + riwayat transaksi, tambah/edit.
- Normalisasi WhatsApp `628xx`, email lowercase.
- Soft delete `archivedAt`; tidak ada hard delete. Pelanggan arsip tidak bisa dipilih untuk transaksi baru atau diedit sampai dipulihkan.
- Detail pelanggan sekarang juga menampilkan daftar invoice, total tagihan, total pembayaran, dan sisa piutang.
- Semua query memakai `businessId`; akses lintas tenant → 404.

## 8. Rental Management

- Daftar/filter/cari/sort/pagination, create, detail, edit saat `ACTIVE`, complete/cancel.
- Nomor `RNT-00001` per bisnis; dibuat dalam transaksi + unique constraint + retry.
- Status transisi hanya `ACTIVE → COMPLETED`/`CANCELLED`; status final tidak bisa diubah.
- Tanggal date-only (UTC midnight, tampil Asia/Jakarta); harga integer Rupiah.
- Detail rental menampilkan daftar invoice, total ditagihkan, total dibayar, dan sisa tagihan.
- **Snapshot**: invoice menyimpan `totalAmount` sendiri. Perubahan harga rental setelah invoice dibuat tidak mengubah invoice. UI edit rental menampilkan peringatan bila sudah ada invoice.

## 9. Invoice Management

Fitur: daftar (cari nomor/pelanggan/rental, filter status, filter tanggal terbit, sorting, pagination), detail, create dari rental, edit, cancel, riwayat pembayaran. Nomor `INV-00001` unik per bisnis.

Keputusan:

- **Satu rental bisa punya banyak invoice.**
- **Snapshot total**: total diisi dari harga rental sebagai default di UI, tetapi disimpan di invoice saat dibuat. Perubahan harga rental tidak mengubah invoice.
- **Nomor otomatis**: count invoice business dalam transaksi + unique `(businessId, invoiceNumber)` + retry maksimal 5 kali.
- **Validasi**: rental dan customer harus satu tenant, rental `CANCELLED` tidak bisa ditagih, total integer > 0, due date ≥ issue date. Tanggal kalender tidak valid ditolak.
- **Edit**: hanya jika tidak cancelled, tidak PAID, dan belum memiliki pembayaran (termasuk pembayaran void). Total/ tanggal/deskripsi/catatan bisa diubah. Rental tidak diubah dari halaman invoice.
- **Cancel**: wajib alasan, menyimpan `cancelledAt` + `cancellationReason`, tidak ada hard delete. Hanya boleh jika tidak ada pembayaran valid; jika ada pembayaran, harus di-void terlebih dahulu. Invoice cancelled tidak dihitung sebagai piutang.
- **Status tidak disimpan**; selalu dihitung backend dari total, pembayaran valid, due date, dan cancelledAt.

## 10. Payment Management

Fitur: catat pembayaran dari detail invoice, riwayat pada invoice, daftar pembayaran, detail pembayaran, void dengan alasan.

Keputusan:

- Metode: `CASH`, `BANK_TRANSFER`, `E_WALLET`, `OTHER`.
- Nominal integer > 0 dan tidak boleh melebihi outstanding. Pembayaran parsial dan beberapa pembayaran diperbolehkan.
- Invoice cancelled atau sudah lunas menolak pembayaran.
- `recordedByUserId` selalu dari session, bukan input browser; `businessId` juga dari session.
- Pencatatan memakai transaksi database: baca invoice + pembayaran valid, hitung outstanding, buat pembayaran, lalu cek ulang total agar tetap ≤ total invoice.
- **Void**: hanya pembayaran valid, alasan wajib, menyimpan `voidedAt`, `voidReason`, `voidedByUserId`. Record tidak dihapus. Pembayaran void tidak dihitung; outstanding/status langsung berubah karena dihitung ulang.
- Tidak ada refund otomatis atau integrasi bank.

## 11. Perhitungan keuangan

Total pembayaran valid = jumlah pembayaran dengan `voidedAt = null`.

`outstanding = max(0, invoice.totalAmount - totalPembayaranValid)`

Prioritas status (dihitung helper backend):

1. `CANCELLED` jika `cancelledAt` terisi; outstanding efektif 0.
2. `PAID` jika outstanding = 0.
3. `OVERDUE` jika outstanding > 0 dan tanggal jatuh tempo (Asia/Jakarta) sudah lewat.
4. `PARTIAL` jika ada pembayaran valid dan outstanding > 0.
5. `UNPAID` jika belum ada pembayaran dan belum jatuh tempo.

Tanggal dianggap terlambat mulai hari setelah due date. Invoice cancelled dan pembayaran void tidak masuk agregat dashboard/piutang. Tidak ada kolom outstanding yang bisa diedit; semua dihitung dari sumber.

## 12. Reminder & WhatsApp manual

Scheduler memakai `@nestjs/schedule` dengan cron `0 9 * * *` dan `timeZone: Asia/Jakarta` eksplisit, bukan timezone server. Job disimpan di database, bukan di memori/Redis/BullMQ.

Aturan default:

| Tipe        | Offset | Jadwal                     |
| ----------- | ------ | -------------------------- |
| `H_MINUS_3` | -3     | 3 hari sebelum jatuh tempo |
| `H_MINUS_1` | -1     | 1 hari sebelum jatuh tempo |
| `DUE_DATE`  | 0      | Pada tanggal jatuh tempo   |
| `H_PLUS_1`  | +1     | 1 hari setelah jatuh tempo |

Alur scheduler (`ReminderSchedulerService.runOnce`):

1. Rekonsiliasi job `PENDING`/`READY`: invoice lunas/dibatalkan → `SKIPPED` + alasan; due date berubah → `SKIPPED`; job yang jadwalnya tiba → `READY`.
2. Job `SKIPPED` karena lunas/dibatalkan dapat diaktifkan kembali jika invoice kembali memiliki sisa tagihan (mis. pembayaran di-void); aktivitas `REACTIVATED` dicatat.
3. Cari invoice aktif dengan due date dalam rentang H-3..H+1 dari hari ini.
4. Hitung outstanding terbaru dari pembayaran valid; invoice lunas/dibatalkan dilewati.
5. Buat job yang belum ada. Unique `(invoiceId, reminderType, scheduledDate)` adalah perlindungan utama anti-duplikasi, bukan hanya pengecekan kode.
6. Job dibuat `READY` bila jadwalnya hari ini, `PENDING` bila tanggalnya masih akan datang.

Scheduler memakai lock in-process agar eksekusi tidak tumpang tindih. Error satu invoice/job dicatat dan tidak menghentikan invoice lain. Scheduler berjalan asinkron di proses yang sama dan hanya memproses invoice yang relevan, sehingga request tetap terlayani; proses berskala besar tetap membutuhkan worker terpisah. Untuk MVP, satu instance; multi-instance tetap aman dari duplikasi karena unique constraint, tetapi belum ada distributed lock.

Pemicu manual:

- Tombol **Jalankan scheduler (dev)** di `/reminders` → `POST /reminders/run`, hanya untuk bisnis aktif, dilindungi login + CSRF + `TenantAuthGuard`, dan mengembalikan 404 di production.
- CLI `npm run reminders:run` (setelah build) menjalankan semua bisnis; dapat memakai `--date=YYYY-MM-DD` untuk simulasi. Ini bukan endpoint publik.

WhatsApp manual:

- URL `https://wa.me/<nomor>?text=<pesan>`; nomor dinormalisasi `628xx`, divalidasi sebelum URL dibuat.
- Pesan memakai nama pelanggan, nomor invoice, nama bisnis, outstanding terbaru, tanggal jatuh tempo, dan Rupiah; tidak memuat data internal.
- Membuka WhatsApp mencatat aktivitas `WHATSAPP_OPENED` dan **tidak** mengubah status menjadi terkirim.
- Status `SENT` hanya dicatat lewat aksi konfirmasi **Tandai sudah dikirim**.
- Reminder `SKIPPED`, invoice lunas, atau invoice dibatalkan tidak dapat membuka WhatsApp; service merekonsiliasi invoice terlebih dahulu.

## 13. Dashboard dan integrasi

Dashboard memakai data nyata: total outstanding, total pembayaran valid, jumlah invoice UNPAID/PARTIAL/OVERDUE/PAID, 5 invoice terbaru, 5 pembayaran terbaru, ringkasan pengingat aktif (belum dihubungi, jatuh tempo hari ini, terlambat, sudah ditandai terkirim), 5 pengingat terbaru, pelanggan aktif, transaksi aktif, status sistem. Tahap 6 menambahkan ringkasan pembayaran dan invoice bulan berjalan, pengingat yang perlu ditindaklanjuti, serta tren enam bulan yang dihitung dari agregasi invoice/pembayaran aktual. Semua dibatasi business aktif dan pengingat untuk invoice lunas/dibatalkan tidak masuk statistik aktif.

Customer detail menampilkan invoice + total tagihan/pembayaran/piutang. Rental detail menampilkan invoice + total/outstanding. Keduanya memakai helper perhitungan yang sama.

## 14. Laporan & export CSV

Route `/reports` memakai tab `summary`, `rentals`, `invoices`, `payments`, `receivables`, `reminders` dan filter periode `today`, `last_7_days`, `last_30_days`, `this_month`, `last_month`, `this_year`, `custom`. Default bulan berjalan; semua batas memakai kalender `Asia/Jakarta` dan inklusif.

Basis tanggal berbeda sesuai laporan:

- Ringkasan: invoice memakai `issueDate`; pembayaran memakai `paymentDate`.
- Rental: `startDate`.
- Invoice: `issueDate`; filter jatuh tempo memakai `dueDate`.
- Pembayaran: `paymentDate`.
- Piutang: snapshot saat ini (tidak dibatasi periode).
- Reminder: `scheduledDate`.

Definisi keuangan:

- Invoice diterbitkan = total `totalAmount` invoice periode, CANCELLED dikecualikan.
- Pembayaran diterima = total payment valid (`voidedAt = null`) berdasarkan `paymentDate`.
- Outstanding = total invoice aktif saat laporan dibuat dikurangi seluruh pembayaran valid pada invoice aktif; bukan selisih transaksi periode.
- Status invoice tetap dihitung backend dengan prioritas CANCELLED → PAID → OVERDUE → PARTIAL → UNPAID.
- Piutang hanya invoice aktif dengan outstanding > 0; kelompok umur dihitung dari `dueDate` dengan batas 0, 1–7, 8–30, >30 hari.
- Reminder `SENT` adalah penanda manual pengguna, bukan bukti pengiriman WhatsApp.

Export CSV tersedia di `/reports/export/{rentals|invoices|payments|receivables|reminders}`. Implementasi memakai generator batch cursor 200 baris, BOM UTF-8, CRLF, escaping kutip/koma/newline, dan proteksi CSV injection untuk nilai teks yang dimulai `=`, `+`, `-`, `@`, tab, atau carriage return. Nominal dikirim sebagai angka tanpa pemisah ribuan. Filter yang sama diterapkan pada seluruh hasil, bukan hanya halaman aktif. Export piutang mengikuti filter pencarian/kelompok, bukan periode.

Query laporan memakai `businessId` dari session, `select/include` terbatas, agregasi Prisma untuk ringkasan, pagination database untuk tabel yang tidak membutuhkan status turunan, dan batch cursor untuk export. Piutang dan filter status invoice yang dihitung di aplikasi masih memuat kandidat dalam memori; ini didokumentasikan sebagai batas MVP.

## 15. Database & konvensi

Skema lengkap di [database.md](database.md). Ringkas:

- `invoices`: `businessId`, `rentalRecordId`, `invoiceNumber` unik per business, issue/due date, `totalAmount` integer, description, notes, cancellation fields.
- `payments`: `businessId`, `invoiceId`, amount integer, paymentDate, method, reference, notes, recordedByUserId, void fields.
- `reminder_jobs`: `businessId`, `invoiceId`, `reminderType`, `scheduledDate`, `status` (`PENDING`/`READY`/`SKIPPED`), `processedAt`, `skippedAt`, `skipReason`. Unique `(invoiceId, reminderType, scheduledDate)`.
- `reminder_activities`: `businessId`, `reminderId`, `userId` nullable (null untuk scheduler), `activityType`, `notes`, `createdAt`. Append-only, tanpa route hapus.
- FK: business Cascade; rental/customer/payment/reminder relations `Restrict` untuk mencegah hard delete historis.
- Index: business + tanggal/status/relasi, invoiceNumber unique, invoiceId, reminder status/scheduledDate.
- Tahap 6 tidak menambah tabel/kolom; laporan memakai index `(businessId, issueDate)`, `(businessId, dueDate)`, `(businessId, startDate)`, `(businessId, paymentDate)`, dan `(businessId, scheduledDate)` yang sudah ada.
- UUID PK, timestamp UTC, tampilan Asia/Jakarta, enum sebagai String.

## 16. Multi-tenancy & keamanan

`TenantAuthGuard` melindungi semua halaman bisnis, termasuk `/reports` dan seluruh export CSV. `businessId` hanya dari session; manipulasi body/query/params → 403. Query invoice/payment/reminder/laporan selalu `{ businessId }`; data tenant lain → 404. Invoice hanya memakai rental dari business aktif; payment hanya memakai invoice business aktif; reminder hanya memakai invoice business aktif. `recordedByUserId`/`voidedByUserId`/activity `userId` diambil dari session. Semua POST melewati CSRF; export merupakan GET read-only. Tidak ada endpoint hard delete.

## 17. Hardening Tahap 7

- **SQLite**: `PRAGMA journal_mode=WAL`, `busy_timeout` (default 5000 ms), dan `foreign_keys=ON` diterapkan saat startup. Deployment wajib satu instance dengan filesystem lokal.
- **Session**: store SQLite, regenerasi setelah login, cookie HttpOnly/SameSite/Secure, pembersihan session kedaluwarsa berkala.
- **Password**: batas bcrypt 72 byte UTF-8 divalidasi pada DTO; tidak ada pemotongan diam-diam.
- **Rate limit**: login, register, export CSV, dan mutasi. In-memory, sehingga tidak cocok untuk multi-instance.
- **Header**: Helmet CSP, frame protection, nosniff, Referrer-Policy, Permissions-Policy; HSTS hanya production + HTTPS.
- **Logging**: path tanpa query/PII; startup/shutdown, database, auth failure, scheduler, backup/restore.
- **Health**: `/health` liveness minimal; `/health/ready` readiness database; tidak membocorkan detail internal.
- **Backup/restore**: SQLite Online Backup API, checksum, integrity/foreign-key check, recovery copy, retention.
- **Dokumentasi operasional**: [deployment.md](deployment.md), [backup-restore.md](backup-restore.md), [security.md](security.md), [performance.md](performance.md).

## 18. Testing

- Unit: finance calculation (semua status, void, agregat), invoice/payment status & methods, DTO invoice/payment, InvoiceService (transaksi, nomor unik + retry, snapshot/update/cancel lock), PaymentService (record, overpay, paid/cancelled, void, tenant scope), reminder rules/planning, message builder + URL encoding, contact status, scheduler generation/dedupe/skip/promote/reactivation, period presets/previous range, CSV escaping/injection/BOM/stream, aging buckets, report calculations, dashboard, customer/rental, auth/security, password byte limit, session cleanup, health.
- E2E: invoice lifecycle, status lifecycle, edit/cancel rules, snapshot terhadap perubahan harga rental, filter/search/pagination, payment partial/full/overpay, void + recalculation, recordedBy dari session, tenant isolation, CSRF/businessId manipulation, reminder H-3/H-1/H/H+1, duplicate scheduler, filter/pagination, WhatsApp open vs mark-sent, paid/cancelled skip, due date change, void reactivation, persistence after restart, dashboard, seluruh tab laporan, filter periode/status/metode/kelompok piutang, CSV BOM/header/nominal/escaping/injection/filter/all-baris/tenant isolation, concurrency SQLite, XSS, cookie, health, rate limit export, dan 404 tanpa query sensitif.
- E2E memakai `prisma/test.db` yang dibersihkan bersama file WAL/SHM sebelum reset.
- Hasil Tahap 7: 223 unit test dan 123 E2E test lulus pada kondisi akhir.

## 19. Yang sengaja ditunda

- Refund otomatis, payment gateway, integrasi bank, WhatsApp Cloud API, SMS/email gateway.
- Distributed scheduler lock, queue worker, multi-instance, Kubernetes.
- Audit trail terpisah untuk perubahan finansial (void/cancel/reminder sudah menyimpan pelaku & waktu).
- PostgreSQL atau migrasi database lain; deployment Tahap 7 tetap SQLite.
- Multi-branch, inventory, booking online, marketplace, subscription.
- Password reset/email verification, WAF/IDS, secret manager eksternal.

Semua item di atas tidak dibuat sebagai tombol atau endpoint palsu. Elemen UI yang belum aktif ditandai dengan label tahap dan penjelasan.
