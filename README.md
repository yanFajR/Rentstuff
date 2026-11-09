# Rental Reminder

Asisten pengelolaan tagihan dan pengingat pembayaran untuk bisnis rental (mobil, motor, kamera, alat berat, perlengkapan bayi, perlengkapan event, dan lainnya).

Rental Reminder bukan marketplace rental dan bukan sistem inventory lengkap. Fokus produk adalah transaksi rental, tagihan, pembayaran, jatuh tempo, dan pengingat pembayaran pelanggan.

## Status pengembangan

**Tahap 1 — Fondasi: selesai.**
**Tahap 2 — Authentication & Business Profile: selesai.**
**Tahap 3 — Customer Management & Rental Management: selesai.**
**Tahap 4 — Invoice & Payment Management: selesai.**
**Tahap 5 — Reminder & WhatsApp Manual: selesai.**
**Tahap 6 — Reports & CSV Export: selesai.**
**Tahap 7 — Security Review, Hardening & Production Readiness (SQLite): selesai.**

Yang sudah berjalan:

- Satu aplikasi NestJS (modular monolith) dengan EJS, HTMX, dan Tailwind CSS.
- Prisma + SQLite dengan migrasi versioned, WAL, busy timeout, integrity check, backup/restore, dan deployment satu instance.
- Autentikasi lengkap: register, login, logout, bcrypt, session server-side, CSRF, rate limiting, pembersihan session kedaluwarsa.
- Profil bisnis dan isolasi data per tenant.
- **Pelanggan**: tambah, lihat, edit, cari, urutkan, pagination, arsip/pulihkan (soft delete), dan riwayat transaksi.
- **Transaksi rental**: nomor otomatis per bisnis, tambah, lihat, edit, filter status/rentang tanggal, pencarian, pagination, serta status `ACTIVE` → `COMPLETED`/`CANCELLED`.
- **Tagihan**: invoice dari rental, nomor otomatis, snapshot total, jatuh tempo, edit selama belum ada pembayaran, pembatalan dengan alasan, status otomatis `UNPAID`/`PARTIAL`/`PAID`/`OVERDUE`/`CANCELLED`.
- **Pembayaran**: pembayaran penuh/parsial/berulang, validasi outstanding di backend, beberapa metode pembayaran, void dengan alasan dan audit pelaku/waktu, riwayat lengkap.
- **Pengingat**: scheduler harian 09.00 WIB untuk H-3, H-1, jatuh tempo, dan H+1; job tersimpan di database dengan unique constraint anti-duplikasi; daftar/detail/filter/pagination; riwayat aktivitas; WhatsApp manual melalui `wa.me`; status `OPENED`/`SENT` hanya dari aktivitas pengguna.
- **Laporan**: ringkasan keuangan, transaksi rental, invoice, pembayaran, piutang berkelompok umur, dan aktivitas reminder; filter periode Asia/Jakarta, pencarian, sorting, pagination, serta export CSV aman.
- **Hardening**: security header, liveness/readiness terpisah, rate limit export/mutasi, logging tanpa query/PII, validasi 72 byte bcrypt, backup/restore SQLite teruji, dan deployment systemd/Nginx.
- Quick-add pelanggan melalui HTMX tanpa meninggalkan form transaksi.
- Dashboard memakai data nyata: outstanding, pembayaran valid, jumlah invoice per status, invoice/pembayaran terbaru, ringkasan pengingat, 5 pengingat terbaru, kinerja bulan ini, dan tren enam bulan.
- Unit test dan end-to-end test untuk seluruh alur, termasuk isolasi tenant, keamanan, CSV, dan concurrency SQLite.

Seluruh modul Tahap 1–7 sudah berjalan.

## Teknologi

| Komponen             | Teknologi                      | Versi terpasang |
| -------------------- | ------------------------------ | --------------- |
| Runtime              | Node.js LTS                    | 26.13.0         |
| Package manager      | npm                            | 11.20.0         |
| Backend              | NestJS (Express)               | 12.4.0          |
| Bahasa               | TypeScript                     | 6.0.3           |
| Template             | EJS                            | 7.0.2           |
| Interaksi UI         | HTMX                           | 2.0.11          |
| CSS                  | Tailwind CSS                   | 4.3.5           |
| ORM                  | Prisma                         | 6.19.3          |
| Database development | SQLite                         | via Prisma      |
| Session              | express-session + Prisma store | 1.19.0          |
| Password hashing     | bcryptjs                       | 3.0.3           |
| Rate limiting        | express-rate-limit             | 8.7.3           |
| Testing              | Jest + Supertest               | 30.5.2 / 7.3.2  |
| Scheduler            | NestJS Schedule                | 12.0.3          |

Proyek menggunakan ESM (`"type": "module"`) karena NestJS 12 dipublikasikan sebagai paket ESM.

## Kebutuhan sistem

- Node.js 22.5 atau lebih baru (diuji pada Node.js 26.13.0 LTS); Node.js 22.5+ diperlukan untuk script backup berbasis `node:sqlite`.
- npm 10 atau lebih baru.
- Tidak memerlukan Docker, Redis, atau PostgreSQL untuk development maupun deployment awal.

## Menjalankan aplikasi (development)

```bash
# 1. Salin konfigurasi environment
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 2. Buat session secret (minimal 32 karakter) dan isi SESSION_SECRET di .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Install dependency (sekaligus generate Prisma Client)
npm install

# 4. Terapkan migrasi database development
npm run db:migrate

# 5. Jalankan aplikasi + Tailwind watcher
npm run dev
```

Buka **http://localhost:3000**, daftar melalui `/register`, lalu mulai menambahkan pelanggan, transaksi, tagihan, dan pembayaran.

| URL                     | Keterangan                                                  |
| ----------------------- | ----------------------------------------------------------- |
| `/`                     | Redirect ke `/dashboard`                                    |
| `/register`, `/login`   | Autentikasi                                                 |
| `/dashboard`            | Ringkasan bisnis dan keuangan (wajib login)                 |
| `/customers`            | Daftar pelanggan; `?q=&sort=&page=`                         |
| `/customers/new`        | Form tambah pelanggan                                       |
| `/customers/:id`        | Detail pelanggan + transaksi + tagihan                      |
| `/customers/:id/edit`   | Form edit pelanggan                                         |
| `/rentals`              | Daftar transaksi; `?q=&status=&from=&to=&sort=&page=`       |
| `/rentals/new`          | Form tambah transaksi (`?customerId=` opsional)             |
| `/rentals/:id`          | Detail transaksi + invoice                                  |
| `/rentals/:id/edit`     | Form edit transaksi (hanya saat aktif)                      |
| `/invoices`             | Daftar tagihan; `?q=&status=&from=&to=&sort=&page=`         |
| `/invoices/new`         | Buat invoice dari rental (`?rentalId=` opsional)            |
| `/invoices/:id`         | Detail invoice + riwayat pembayaran                         |
| `/invoices/:id/edit`    | Edit invoice (hanya tanpa pembayaran)                       |
| `/payments`             | Daftar pembayaran; `?q=&status=valid\|void&page=`           |
| `/payments/:id`         | Detail pembayaran + void                                    |
| `/reminders`            | Daftar pengingat; `?q=&type=&status=&from=&to=&sort=&page=` |
| `/reminders/:id`        | Detail pengingat, pratinjau WhatsApp, dan timeline          |
| `/reports`              | Laporan; `?tab=&period=&from=&to=` dan filter per tab       |
| `/reports/export/:type` | Export CSV: rentals/invoices/payments/receivables/reminders |
| `/settings`             | Profil bisnis dan akun (wajib login)                        |
| `/health`               | Health check JSON                                           |
| `/health/partial`       | Partial HTML untuk polling HTMX di dashboard                |

## Perintah npm

| Perintah                | Fungsi                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `npm run dev`           | NestJS watch mode + Tailwind watch mode                           |
| `npm run build`         | Generate Prisma Client, build CSS, lalu compile NestJS ke `dist/` |
| `npm run start:prod`    | Menjalankan hasil build (`node dist/main.js`)                     |
| `npm run db:migrate`    | Membuat & menerapkan migrasi Prisma (development)                 |
| `npm run db:deploy`     | Menerapkan migrasi yang ada tanpa membuat migrasi baru            |
| `npm run db:studio`     | Membuka Prisma Studio                                             |
| `npm run db:reset`      | Reset database development dan menerapkan ulang migrasi           |
| `npm run reminders:run` | Menjalankan scheduler untuk semua bisnis dari hasil build         |
| `npm run typecheck`     | Type-check seluruh source & test                                  |
| `npm run lint`          | ESLint dengan `--max-warnings=0`                                  |
| `npm test`              | Unit test (Jest)                                                  |
| `npm run test:e2e`      | End-to-end test pada `prisma/test.db` yang di-reset otomatis      |
| `npm run verify`        | typecheck + lint + unit test + e2e test + build                   |

## Konfigurasi environment

Variabel wajib: `APP_URL`, `DATABASE_URL`, dan `SESSION_SECRET` (minimal 32 karakter).

| Variabel                   | Default              | Keterangan                            |
| -------------------------- | -------------------- | ------------------------------------- |
| `SESSION_TTL_HOURS`        | `8`                  | Masa berlaku sesi (rolling)           |
| `SESSION_COOKIE_SECURE`    | `true` di production | Wajib `true` bila diakses via HTTPS   |
| `AUTH_LOGIN_RATE_LIMIT`    | `10`                 | Maksimal percobaan login gagal per IP |
| `AUTH_REGISTER_RATE_LIMIT` | `10`                 | Maksimal percobaan registrasi per IP  |

Detail lengkap ada di [docs/installation.md](docs/installation.md).

## Database

- File database development: `prisma/dev.db`; database test: `prisma/test.db` (dibuat ulang otomatis sebelum e2e).
- Migrasi berada di `prisma/migrations/` dan ikut di-commit.
- Entitas: `users`, `businesses`, `business_members`, `sessions`, `customers`, `rental_records`, `invoices`, `payments`, `reminder_jobs`, `reminder_activities`.
- Foreign key constraints SQLite diaktifkan oleh konektor Prisma.
- Detail skema dan konvensi ada di [docs/database.md](docs/database.md).

## Alur singkat

1. **Pelanggan** — nomor WhatsApp divalidasi dan dinormalisasi ke `628xx`; pelanggan dapat diarsipkan tanpa menghapus riwayat.
2. **Transaksi** — pelanggan wajib aktif dan berasal dari bisnis yang sama; nomor transaksi `RNT-00001` dibuat otomatis dan unik per bisnis.
3. **Tagihan** — invoice dibuat dari rental; total disimpan sebagai snapshot sehingga perubahan harga rental setelahnya tidak mengubah invoice.
4. **Pembayaran** — penuh/parsial dicatat dalam transaksi database dan tidak boleh melebihi sisa tagihan; void menyimpan alasan/pelaku/waktu dan tidak menghapus record.
5. **Status** — dihitung backend: CANCELLED → PAID → OVERDUE (jika lewat jatuh tempo) → PARTIAL → UNPAID.
6. **Pengingat** — scheduler membuat job H-3/H-1/jatuh tempo/H+1 di database; invoice lunas/dibatalkan dilewati; WhatsApp dibuka manual dan status terkirim hanya setelah pengguna menandainya.
7. **Laporan** — ringkasan, rental, invoice, pembayaran, piutang, dan reminder memakai data aktual; filter periode Asia/Jakarta dan export CSV mengikuti filter aktif.
8. **Isolasi tenant** — semua query memakai `businessId` dari konteks autentikasi; `businessId` dari request ditolak 403.

## Struktur project

```text
rental-reminder/
├── src/
│   ├── auth/                  # Register, login, logout, password, rate limit
│   ├── businesses/            # Profil bisnis (/settings)
│   ├── customers/             # CRUD pelanggan, arsip, quick-add
│   ├── rentals/               # CRUD transaksi, status, nomor otomatis
│   ├── invoices/              # Invoice, status, pembatalan
│   ├── payments/              # Pembayaran, void, riwayat
│   ├── reminders/             # Rules, scheduler, job, aktivitas, WhatsApp manual
│   ├── reports/               # Laporan, filter periode, agregasi, export CSV
│   ├── dashboard/             # Ringkasan operasional, keuangan, tren, dan pengingat
│   ├── common/                # Auth, config, finance, filters, helpers,
│   │                          # prisma, security, session, validation, middleware
│   ├── styles/app.css         # Entry Tailwind CSS
│   ├── views/                 # EJS: auth, customers, rentals, invoices, payments, reminders, reports
│   ├── app.module.ts
│   ├── app.setup.ts
│   └── main.ts
├── public/                    # css (generated), js, images
├── prisma/                    # schema.prisma, migrations/, dev.db & test.db
├── tests/                     # E2E test + utilities
├── docs/                      # Arsitektur, database, instalasi, migrasi PostgreSQL
├── .env.example
└── package.json
```

## Dokumentasi

- [Arsitektur & keputusan teknis](docs/architecture.md)
- [Skema database](docs/database.md)
- [Instalasi & troubleshooting](docs/installation.md)
- [Panduan laporan & CSV](docs/reports.md)
- [Security review & hardening](docs/security.md)
- [Deployment production SQLite](docs/deployment.md)
- [Backup, restore & integrity](docs/backup-restore.md)
- [Hasil performance test](docs/performance.md)
- [Persiapan migrasi PostgreSQL](docs/postgresql-migration.md)

## Perintah operasional

```bash
npm run db:check                     # PRAGMA integrity_check + foreign_key_check
npm run db:backup                    # backup SQLite aman (default daily)
npm run db:restore -- --backup=... --yes
npm run perf:seed                    # seed QA 1.000/5.000/10.000/20.000/10.000/30.000
npm run perf:test                    # ukur endpoint pada server QA
npm run reminders:run                # trigger scheduler manual (setelah build)
```

## Tahapan berikutnya

| Tahap | Cakupan                                                                         |
| ----- | ------------------------------------------------------------------------------- |
| 5     | Reminder rules, NestJS Schedule, reminder logs, anti-duplikasi, WhatsApp manual |
| 6     | Laporan, export CSV, penyempurnaan dashboard                                    |
| 7     | Security review, hardening SQLite, backup/restore, deployment, performance      |

Tahap 7 selesai. Status: **READY WITH LIMITATIONS** untuk deployment awal satu instance SQLite. Tidak ada fitur bisnis baru yang ditambahkan pada Tahap 7.
#   R e n t s t u f f  
 