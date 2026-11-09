# Instalasi & Menjalankan Aplikasi

Panduan setup development, konfigurasi environment, migrasi database, fitur per halaman, build production, dan troubleshooting.

## 1. Prasyarat

- Node.js 22.5+ (diuji pada Node.js 26.13.0 LTS); Node.js 22.5+ diperlukan untuk modul `node:sqlite` pada backup.
- npm 10+ (diuji pada npm 11.20.0).
- Git (opsional).

```bash
node --version
npm --version
```

## 2. Instalasi dependency

```bash
npm install
```

`postinstall` otomatis menjalankan `prisma generate`.

## 3. Konfigurasi environment

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Buat `SESSION_SECRET` acak (minimal 32 karakter) dan isi ke `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variabel                       | Wajib | Default               | Keterangan                                           |
| ------------------------------ | ----- | --------------------- | ---------------------------------------------------- |
| `NODE_ENV`                     | tidak | `development`         | `development`, `test`, atau `production`             |
| `PORT`                         | tidak | `3000`                | Port HTTP                                            |
| `APP_NAME`                     | tidak | `Rental Reminder`     | Nama aplikasi di UI dan judul halaman                |
| `APP_URL`                      | ya    | —                     | URL publik aplikasi, harus `http://` atau `https://` |
| `APP_TIMEZONE`                 | tidak | `Asia/Jakarta`        | Zona waktu tampilan & jadwal pengingat               |
| `DATABASE_URL`                 | ya    | —                     | Koneksi Prisma, contoh `file:./dev.db`               |
| `SESSION_SECRET`               | ya    | —                     | Secret penandatangan cookie, minimal 32 karakter     |
| `SESSION_NAME`                 | tidak | `rental_reminder.sid` | Nama cookie session                                  |
| `SESSION_TTL_HOURS`            | tidak | `8`                   | Masa berlaku session (rolling)                       |
| `SESSION_CLEANUP_INTERVAL_MS`  | tidak | `3600000`             | Interval pembersihan session kedaluwarsa             |
| `SESSION_COOKIE_SECURE`        | tidak | `true` di production  | Wajib `true` bila diakses via HTTPS                  |
| `AUTH_LOGIN_RATE_LIMIT`        | tidak | `10`                  | Maksimal percobaan login gagal per IP                |
| `AUTH_LOGIN_RATE_WINDOW_MS`    | tidak | `900000`              | Jendela rate limit login (15 menit)                  |
| `AUTH_REGISTER_RATE_LIMIT`     | tidak | `10`                  | Maksimal percobaan registrasi per IP                 |
| `AUTH_REGISTER_RATE_WINDOW_MS` | tidak | `3600000`             | Jendela rate limit registrasi (1 jam)                |
| `REPORT_EXPORT_RATE_LIMIT`     | tidak | `30`                  | Maksimal export CSV per IP                           |
| `REPORT_EXPORT_RATE_WINDOW_MS` | tidak | `900000`              | Jendela limit export (15 menit)                      |
| `MUTATION_RATE_LIMIT`          | tidak | `300`                 | Batas operasi POST per IP                            |
| `MUTATION_RATE_WINDOW_MS`      | tidak | `300000`              | Jendela limit mutasi (5 menit)                       |
| `SQLITE_JOURNAL_MODE`          | tidak | `WAL`                 | Mode jurnal SQLite                                   |
| `SQLITE_BUSY_TIMEOUT_MS`       | tidak | `5000`                | Waktu tunggu lock SQLite                             |
| `BACKUP_DIR`                   | tidak | `backups/`            | Lokasi backup (script, bukan runtime web)            |

Aplikasi menolak start bila variabel wajib tidak ada atau tidak valid. File `.env` tidak boleh di-commit.

Catatan production: cookie `Secure` hanya dikirim melalui HTTPS. Jalankan di belakang reverse proxy HTTPS; `trust proxy` aktif otomatis pada `NODE_ENV=production`.

## 4. Database development

```bash
npm run db:migrate
```

Perintah ini membuat/menerapkan migrasi Prisma dan menghasilkan `prisma/dev.db`. Migrasi Tahap 1–5 sudah tersedia dan tidak boleh dihapus. Tahap 6 dan 7 tidak menambah migration karena laporan/hardening hanya membaca skema yang sudah ada.

Deployment production dengan SQLite, systemd, Nginx, backup, dan restore dijelaskan di [deployment.md](deployment.md) dan [backup-restore.md](backup-restore.md).

Perintah lain:

```bash
npm run db:deploy   # terapkan migrasi yang sudah ada (production/staging)
npm run db:studio   # buka Prisma Studio
npm run db:reset    # hapus & buat ulang database development
```

Tabel yang dibuat: `users`, `businesses`, `business_members`, `sessions`, `customers`, `rental_records`, `invoices`, `payments`, `reminder_jobs`, `reminder_activities`, plus `_prisma_migrations`.

Detail skema ada di [database.md](database.md).

## 5. Menjalankan development

```bash
npm run dev
```

Menjalankan dua proses:

1. `nest start --watch` — compile TypeScript dan restart otomatis.
2. `tailwindcss --watch` — rebuild CSS saat template/class berubah.

Buka http://localhost:3000.

Alur pertama kali:

1. Buka `/register`, isi nama, email, kata sandi (8–72 karakter, huruf + angka), konfirmasi, dan nama bisnis.
2. User, bisnis, dan membership `OWNER` dibuat dalam satu transaksi; Anda langsung masuk ke dashboard.
3. Buka `/settings` untuk melengkapi WhatsApp, alamat, dan deskripsi bisnis.
4. Buka `/customers` untuk menambahkan pelanggan.
5. Buka `/rentals/new` untuk membuat transaksi. Nomor transaksi dibuat otomatis (`RNT-00001`).

### Halaman utama setelah login

| URL                     | Keterangan                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `/dashboard`            | Statistik nyata: pelanggan, transaksi aktif/selesai/total, terbaru |
| `/customers`            | Daftar pelanggan; pencarian, sorting, pagination                   |
| `/customers/new`        | Form tambah pelanggan                                              |
| `/customers/:id`        | Detail pelanggan + riwayat transaksi                               |
| `/customers/:id/edit`   | Form edit pelanggan                                                |
| `/rentals`              | Daftar transaksi; filter status/tanggal, pencarian, sorting        |
| `/rentals/new`          | Form transaksi + quick-add pelanggan via HTMX                      |
| `/rentals/:id`          | Detail transaksi + aksi status                                     |
| `/rentals/:id/edit`     | Form edit transaksi (hanya status `ACTIVE`)                        |
| `/invoices`             | Daftar tagihan; filter status/tanggal, pencarian, sorting          |
| `/invoices/new`         | Buat invoice dari rental, total default dari harga rental          |
| `/invoices/:id`         | Detail invoice + riwayat pembayaran + aksi                         |
| `/invoices/:id/edit`    | Edit invoice (hanya jika belum ada pembayaran)                     |
| `/payments`             | Daftar pembayaran valid/void                                       |
| `/payments/:id`         | Detail pembayaran + void                                           |
| `/reminders`            | Daftar pengingat + ringkasan kategori + scheduler manual (dev)     |
| `/reminders/:id`        | Detail pengingat, pratinjau WhatsApp, aksi, dan timeline aktivitas |
| `/reports`              | Laporan ringkasan, rental, invoice, pembayaran, piutang, reminder  |
| `/reports/export/:type` | Export CSV dengan filter aktif                                     |
| `/settings`             | Profil bisnis dan informasi akun                                   |

Catatan perilaku:

- Pelanggan tidak dihapus permanen. Tombol **Arsipkan** mengisi `archivedAt`; riwayat transaksi tetap tersimpan. Pelanggan arsip tidak muncul pada pilihan transaksi baru dan dapat **Dipulihkan**.
- Transaksi baru berstatus `ACTIVE`. Aksi **Tandai selesai** dan **Batalkan** meminta konfirmasi dan bersifat final.
- Transaksi selesai/dibatalkan tidak dapat diedit; halaman edit mengarahkan kembali ke detail.
- Semua form perubahan dilindungi CSRF; `businessId` dari request ditolak dengan 403.
- Invoice menyimpan total snapshot. Mengubah harga rental setelah invoice dibuat tidak mengubah tagihan tersebut.
- Invoice tanpa pembayaran dapat diedit/dibatalkan. Jika sudah ada pembayaran valid, void pembayaran terlebih dahulu; invoice yang sudah lunas tidak dapat diedit.
- Pembayaran tidak boleh melebihi sisa tagihan. Void tidak menghapus record dan langsung menghitung ulang outstanding/status.
- Status invoice dihitung backend: CANCELLED → PAID → OVERDUE → PARTIAL → UNPAID.
- Scheduler pengingat berjalan otomatis setiap hari pukul 09.00 WIB dengan timezone eksplisit `Asia/Jakarta`; job disimpan di database dan aman dari duplikasi.
- Job pengingat memakai outstanding terbaru. Invoice lunas/dibatalkan tidak menghasilkan pengingat baru; job lama ditandai `SKIPPED` dengan alasan.
- Membuka WhatsApp hanya mencatat `WHATSAPP_OPENED`. Status `SENT` baru dicatat setelah Anda menekan **Tandai sudah dikirim** dan mengonfirmasi.
- Jika invoice lunas/dibatalkan setelah pengingat dibuat, tombol WhatsApp dinonaktifkan dan job ditandai `SKIPPED`.
- Di development/test, tombol **Jalankan scheduler (dev)** memproses bisnis aktif tanpa menunggu pukul 09.00. Endpoint ini dilindungi login + CSRF dan mengembalikan 404 di production.
- Scheduler untuk semua bisnis dapat dijalankan dari CLI setelah build: `npm run reminders:run` (opsional `--date=YYYY-MM-DD` untuk simulasi tanggal).
- Laporan memakai periode default bulan berjalan dengan kalender `Asia/Jakarta`. Filter periode/status/metode/kelompok diterapkan pada tabel dan export.
- Export CSV memakai BOM UTF-8, nominal angka mentah, dan proteksi formula injection. Buka file dengan Excel/LibreOffice atau periksa langsung; filter aktif ikut diterapkan.
- Laporan piutang adalah snapshot saat ini; periode tidak membatasi daftar piutang.

## 6. Build & menjalankan production

```bash
npm run build
npm run start:prod
```

`npm run build` menjalankan:

1. `prisma generate`
2. build Tailwind ke `public/css/app.css`
3. `nest build` ke `dist/` (termasuk penyalinan `src/views` ke `dist/views`)

Checklist production:

- Set `NODE_ENV=production`.
- Sediakan `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, dan `PORT` dari environment platform.
- Jalankan `npm run db:deploy` sebelum aplikasi start.
- Pastikan HTTPS aktif dan `SESSION_COOKIE_SECURE=true` (default production).
- Jangan gunakan `SESSION_SECRET` yang sama dengan development.
- Scheduler memakai timezone eksplisit `Asia/Jakarta` dan berjalan pukul 09.00; jangan mengandalkan timezone server. Pastikan hanya satu instance scheduler aktif, atau biarkan unique constraint database mencegah duplikasi.
- Tombol pemicu manual tidak tersedia di production. Untuk operasi manual, build lalu jalankan `npm run reminders:run` dari host aplikasi.
- `public/` dan `node_modules/htmx.org` harus tersedia di direktori kerja proses.

## 7. Testing

```bash
npm test          # unit test
npm run test:e2e  # end-to-end test
npm run verify    # typecheck + lint + unit + e2e + build
```

- Unit test berjalan tanpa database.
- E2E memakai `prisma/test.db` yang **di-reset otomatis** oleh `pretest:e2e` (`prisma migrate reset --force`), sehingga data development tidak tercemar.
- `tests/setup-env.ts` menetapkan environment test (database test, secret test, rate limit tinggi) sebelum aplikasi dibuat.
- Test berjalan in-process dengan Supertest, bukan pada port publik.
- Test pengingat mencakup rules H-3/H-1/jatuh tempo/H+1, anti-duplikasi, skip saat lunas/dibatalkan, perubahan due date, reaktivasi setelah void, WhatsApp `OPENED` vs `SENT`, isolasi tenant, CSRF, dan persistensi setelah restart aplikasi.
- Test laporan mencakup tab ringkasan/rental/invoice/pembayaran/piutang/reminder, periode, filter, pagination, CSV BOM/header/escaping/injection/filter/seluruh baris, dan isolasi tenant.
- Jest ESM membutuhkan `NODE_OPTIONS=--experimental-vm-modules` (sudah diatur via `cross-env`).

## 8. Troubleshooting

**Port 3000 sudah dipakai**

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
Stop-Process -Id <PID>
```

Atau ubah `PORT` di `.env`.

**Aplikasi gagal start: `SESSION_SECRET is required` / `must be at least 32 characters`**

Isi `SESSION_SECRET` di `.env` dengan nilai acak minimal 32 karakter dan restart.

**`Sesi keamanan tidak valid atau sudah kedaluwarsa` (HTTP 403)**

Token CSRF tidak cocok: session kedaluwarsa, cookie dihapus, atau form lama dikirim ulang. Muat ulang halaman lalu submit lagi.

**`Terlalu banyak percobaan` (HTTP 429)**

Rate limiter aktif. Tunggu jendela waktu selesai (default 15 menit login, 1 jam registrasi), atau sesuaikan `AUTH_*_RATE_*` di development. Limiter in-memory dan reset saat restart.

**Login selalu gagal padahal password benar**

- Pastikan email sama (normalisasi lowercase).
- Periksa `users.isActive` di Prisma Studio.
- Periksa user memiliki baris `business_members`; akun tanpa bisnis ditolak.

**Session hilang setelah restart atau tidak valid di instance lain**

Pastikan semua instance memakai `DATABASE_URL` yang sama. Session disimpan di tabel `sessions`; jika belum ada jalankan `npm run db:deploy`.

**Cookie session tidak terkirim di production**

Cookie `Secure` memerlukan HTTPS. Aktifkan HTTPS di reverse proxy atau set `SESSION_COOKIE_SECURE=false` hanya untuk pengujian internal.

**`@prisma/client did not initialize yet`**

```bash
npm run db:generate
```

**`EPERM: operation not permitted, rename ... query_engine-windows.dll.node`**

Prisma tidak dapat mengganti file engine karena masih dipakai proses aplikasi/dev watcher. Hentikan `npm run dev`, `node dist/main.js`, atau proses Nest/Tailwind yang berjalan, lalu ulangi `npm run db:generate` / `npm run build`.

**Pencarian atau filter tidak menemukan data**

- Pencarian pelanggan mencocokkan nama dan nomor WhatsApp (format asli maupun `628xx`).
- Filter tanggal transaksi memakai `startDate`; pastikan rentang `from`/`to` mencakup tanggal mulai.
- Pelanggan yang diarsipkan tidak muncul pada pilihan transaksi baru.

**Database belum punya tabel / health check 503**

```bash
npm run db:deploy
```

**Template tidak ditemukan (`Failed to lookup view`)**

- Development: jalankan dari root project dan pastikan `src/views` ada.
- Production: jalankan `npm run build` agar `dist/views` tersalin, lalu `node dist/main.js` dari root project.

**CSS tidak terlihat / tampilan polos**

```bash
npm run css:build
```

**`Cannot find module './xxx.js'`**

Project ESM. Import relatif TypeScript wajib memakai ekstensi `.js`.

**Peringatan `ExperimentalWarning: VM Modules`**

Peringatan saat Jest ESM berjalan; bukan error.

**Jest gagal dengan `Cannot require() ES Module`**

Dependency CJS yang meng-`require` paket Nest ESM tidak kompatibel dengan runtime Jest ESM. Gunakan alternatif dual/ESM-compatible (seperti `express-rate-limit` dan `bcryptjs`).
