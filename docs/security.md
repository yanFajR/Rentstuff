# Security Review & Hardening — Tahap 7

Dokumen ini merangkum audit keamanan berdasarkan implementasi aktual, bukan klaim bahwa aplikasi bebas vulnerability. Seluruh temuan harus dibaca bersama batasan deployment satu instance SQLite.

## 1. Baseline

- Unit test awal: 220/220 lulus.
- E2E test awal: 110/110 lulus.
- `prisma validate`: valid.
- `prisma migrate status`: 5 migrasi, schema up to date.
- SQLite awal: `journal_mode=delete`, `busy_timeout=0`, `foreign_keys=1`, integrity `ok`.
- Dependency audit awal: 29 temuan (3 high, 22 moderate, 4 low), tanpa critical.

## 2. Temuan dan perbaikan

| Severity | Temuan                                                                                                            | Perbaikan                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| High     | Batas password bcrypt 72 **byte** tidak ditegakkan; password Unicode >72 byte dapat terpotong diam-diam.          | Validator `MaxByteLength(72)` pada login/register/konfirmasi, pesan error jelas, unit + E2E test.          |
| High     | SQLite berjalan tanpa WAL dan `busy_timeout=0`; risiko `SQLITE_BUSY` pada pembayaran/invoice/scheduler bersamaan. | `PRAGMA journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON` saat startup; E2E concurrency.           |
| High     | Tidak ada mekanisme backup/restore SQLite yang aman dan teruji.                                                   | Script backup Online Backup API, restore, checksum, integrity/foreign-key check, retention, recovery test. |
| Medium   | Session kedaluwarsa hanya dibersihkan saat diakses; dapat menumpuk.                                               | `SessionCleanupService` berkala + pembersihan saat bootstrap, test.                                        |
| Medium   | `/health` membocorkan environment, timezone, provider, latensi database.                                          | Liveness minimal, readiness terpisah, partial aman tanpa detail internal.                                  |
| Medium   | Request/error log mencatat query string yang dapat memuat PII.                                                    | Log hanya path tanpa query; error JSON juga hanya path.                                                    |
| Medium   | Tidak ada rate limit khusus export CSV dan operasi mutasi.                                                        | Middleware rate limit export dan mutasi; login/register tetap lebih ketat.                                 |
| Medium   | Cookie session dihapus tanpa opsi yang sama; potensi cookie tidak bersih sempurna.                                | `clearCookie` memakai path/httpOnly/sameSite/secure yang konsisten.                                        |
| Medium   | Security header belum memiliki Permissions-Policy; HSTS belum eksplisit.                                          | Permissions-Policy ditambahkan; HSTS hanya production + HTTPS.                                             |
| Low      | Input query/pagination tidak dibatasi panjang halaman.                                                            | Query string dibatasi 200 karakter; halaman dibatasi 10.000.                                               |
| Low      | Login gagal tidak dicatat untuk operasional.                                                                      | Log status kegagalan + IP, tanpa email/password/token.                                                     |
| Low      | Tidak ada log shutdown/penutupan database.                                                                        | `enableShutdownHooks()`, log startup/shutdown, Prisma destroy log.                                         |

## 3. Authentication & session

- Password memakai bcrypt cost 12; login email tidak dikenal memakai timing equalizer.
- Password >72 byte ditolak sebelum bcrypt; tidak ada pemotongan diam-diam.
- Login meregenerasi session ID; logout menghancurkan session di database dan cookie.
- Session store SQLite (`PrismaSessionStore`), bukan MemoryStore; session tetap valid setelah restart.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` mengikuti konfigurasi, `Path=/`, max age.
- Session cleanup berkala tidak memblokir request; query `deleteMany` hanya menghapus yang sudah kedaluwarsa.
- Default production `SESSION_COOKIE_SECURE=true`; startup gagal jika `APP_URL=https://` tetapi secure dimatikan.
- SESSION_SECRET minimal 32 karakter dan wajib; nilai contoh ditolak pada production.

Catatan: akun nonaktif/tanpa bisnis masih memberi pesan berbeda setelah kredensial benar. Ini bukan enumerasi email tanpa password, tetapi bisa mengungkap status akun kepada pemilik password.

## 4. Authorization & multi-tenancy

- Seluruh controller bisnis memakai `TenantAuthGuard`.
- `businessId` dan `userId` diambil dari session yang sudah divalidasi membership-nya.
- Guard menolak `businessId`/`business_id` yang disuntikkan lewat body/query/params.
- Service memakai `businessId` dari auth context; update/cancel/void/export tetap ter-scope.
- Relasi customer/rental/invoice/payment/reminder diperiksa dalam transaksi dan tenant yang sama.
- E2E tenant isolation, IDOR, dan security tetap dijalankan.

## 5. CSRF, XSS, dan input

- CSRF guard global pada semua metode mutasi; token 32 byte, dibandingkan `timingSafeEqual`.
- Semua form POST memakai `_csrf`; HTMX juga mengirim token.
- Respons error HTMX di-escape.
- EJS memakai `<%=` untuk data pengguna; `<%-` hanya untuk include/atribut yang dikendalikan server.
- Test XSS nama pelanggan dan test pencarian berbahaya ditambahkan.
- DTO membatasi panjang nama, email, alamat, catatan, deskripsi, nomor invoice/rental, nominal, tanggal, dan enum.
- Whitelist class-validator aktif; properti asing tidak masuk service.
- Sorting memakai whitelist kolom; bukan nama kolom arbitrer dari browser.
- Pencarian memakai query Prisma parameterized; tidak ada raw SQL untuk input pengguna.
- CSV injection sudah ditangani dengan prefix apostrof untuk sel teks berbahaya.

## 6. Header keamanan

Helmet mengaktifkan CSP `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, dan Referrer-Policy `same-origin`. Tidak ada inline script/style yang memerlukan pengecualian CSP.

Tambahan:

- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`.
- HSTS `max-age=31536000; includeSubDomains` hanya jika production dan APP_URL HTTPS.
- `X-Powered-By` dimatikan.
- `trust proxy = 1` pada production; sesuaikan jika topologi proxy berbeda.

## 7. Rate limiting dan logging

- Login/register: limit terpisah, in-memory.
- Export CSV: limit default 30 per 15 menit.
- Mutasi: limit default 300 per 5 menit.
- Error 429 memakai pesan yang jelas.
- In-memory rate limit hilang saat restart dan tidak dibagi antar-instance; ini alasan deployment satu instance.
- Log tidak mencatat password, cookie, CSRF token, session ID, secret, atau query string.
- Log mencatat startup/shutdown, koneksi database, kegagalan login, error HTTP, scheduler, backup/restore script.
- Health liveness/readiness tidak membocorkan provider, environment, latency, atau detail internal.

## 8. Dependency audit

`npm audit` pada seluruh dependency: 29 temuan, tanpa critical.

- 3 high berasal dari rantai `prisma` → `@prisma/config` → `deepmerge-ts` (GHSA-ggr8-5vv4-36mx, stack exhaustion saat merge objek rekursif).
- Perbaikan yang ditawarkan adalah Prisma 7.10.1 (major). Tahap 7 melarang penggantian/migrasi Prisma; upgrade major tidak dilakukan otomatis.
- Rantai ini adalah tooling CLI/config Prisma, bukan jalur request runtime aplikasi. Tetap dicatat sebagai risiko supply-chain/tooling.
- Temuan moderate/low lain berasal dari Jest, ts-jest, glob/minimatch, dan typescript-eslint (tooling development).
- Tidak dilakukan `npm audit fix --force` dan tidak ada penghapusan dependency yang masih dipakai.

## 9. Risiko yang masih tersisa

- Deployment harus satu instance; tidak ada distributed lock.
- Rate limit in-memory tidak bertahan setelah restart dan tidak cocok untuk multi-instance.
- Prisma CLI memiliki advisory high yang perbaikannya memerlukan major upgrade di luar scope.
- Aplikasi belum memiliki WAF, IDS, malware scanning, atau secret manager eksternal.
- Backup lokal tidak melindungi dari kehilangan seluruh server; salinan offsite wajib.
- Belum ada password reset/email verification (di luar fitur Tahap 1–7).
- Pesan status akun setelah kredensial benar masih berbeda untuk nonaktif/tanpa bisnis.
- Tidak ada automated external penetration test; pengujian dilakukan pada level aplikasi/QA.
- Shell scripts backup/restore memerlukan Node.js 22.5+ dan filesystem lokal.

## 10. Status

Berdasarkan pengujian aktual, aplikasi layak dianggap **READY WITH LIMITATIONS** untuk deployment awal satu instance SQLite, dengan syarat backup offsite, HTTPS, monitoring, dan prosedur restore diuji berkala. Bukan klaim bebas vulnerability.
