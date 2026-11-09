# Deployment Production — SQLite

Panduan ini menargetkan **Ubuntu Server LTS**, Node.js LTS, build NestJS, SQLite pada penyimpanan persistent, reverse proxy HTTPS, dan `systemd`.

## 1. Topologi yang didukung

Tahap 7 hanya mendukung **satu instance aplikasi** yang mengakses satu file SQLite.

Alasannya:

- scheduler reminder memakai lock in-process;
- rate limiting masih in-memory;
- SQLite mengunci writer pada level database;
- backup dan WAL mengharuskan filesystem lokal yang mendukung locking SQLite.

Jangan menjalankan dua proses aplikasi, PM2 cluster mode, atau dua container terhadap file SQLite yang sama. Untuk multi-instance, arsitektur harus dievaluasi ulang pada tahap berikutnya (misalnya database server dan distributed lock), bukan dipaksakan dengan Redis pada Tahap 7.

## 2. Persiapan server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ca-certificates nginx ufw unzip
sudo timedatectl set-timezone Asia/Jakarta
sudo adduser --system --group --home /opt/rental-reminder rental
```

Node.js LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

Gunakan Node.js 22.5 atau lebih baru agar modul `node:sqlite` untuk backup tersedia. Versi yang diuji pada repository ini adalah Node.js 26.

## 3. Direktori dan permission

Database **tidak boleh** berada di dalam direktori source, `public/`, atau folder yang dihapus saat deploy baru.

```bash
sudo mkdir -p /opt/rental-reminder /var/lib/rental-reminder /var/backups/rental-reminder /etc/rental-reminder
sudo chown -R rental:rental /opt/rental-reminder /var/lib/rental-reminder /var/backups/rental-reminder
sudo chmod 750 /var/lib/rental-reminder /var/backups/rental-reminder
```

File database akan dibuat oleh aplikasi. Setelah ada:

```bash
sudo chown rental:rental /var/lib/rental-reminder/rental.db
sudo chmod 600 /var/lib/rental-reminder/rental.db
```

Pastikan web server tidak menyajikan `/var/lib/rental-reminder` atau `/var/backups/rental-reminder`.

## 4. Ambil source dan dependency

```bash
sudo -u rental git clone <repository-url> /opt/rental-reminder
cd /opt/rental-reminder
sudo -u rental npm ci
```

Build membutuhkan dependency development (`nest`, Tailwind, Prisma CLI). Lakukan migrasi dan build **sebelum** `npm prune --omit=dev`.

## 5. Environment production

Buat `/etc/rental-reminder/rental.env` dengan permission `600`:

```bash
sudo install -m 600 -o rental -g rental /dev/null /etc/rental-reminder/rental.env
sudo -u rental nano /etc/rental-reminder/rental.env
```

Contoh:

```dotenv
NODE_ENV=production
PORT=3000
APP_NAME="Rental Reminder"
APP_URL=https://rental.example.com
APP_TIMEZONE=Asia/Jakarta

DATABASE_URL="file:/var/lib/rental-reminder/rental.db"

SESSION_SECRET=<hasil random 32 byte>
SESSION_NAME=rental_reminder.sid
SESSION_TTL_HOURS=8
SESSION_CLEANUP_INTERVAL_MS=3600000
SESSION_COOKIE_SECURE=true

AUTH_LOGIN_RATE_LIMIT=10
AUTH_LOGIN_RATE_WINDOW_MS=900000
AUTH_REGISTER_RATE_LIMIT=10
AUTH_REGISTER_RATE_WINDOW_MS=3600000
REPORT_EXPORT_RATE_LIMIT=30
REPORT_EXPORT_RATE_WINDOW_MS=900000
MUTATION_RATE_LIMIT=300
MUTATION_RATE_WINDOW_MS=300000

SQLITE_JOURNAL_MODE=WAL
SQLITE_BUSY_TIMEOUT_MS=5000

BACKUP_DIR=/var/backups/rental-reminder
```

Buat secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jangan commit file environment. Aplikasi akan gagal start jika konfigurasi wajib tidak valid, `DATABASE_URL` bukan SQLite, atau `SESSION_COOKIE_SECURE=false` saat `APP_URL` production memakai HTTPS.

## 6. Migrasi dan build

```bash
cd /opt/rental-reminder
sudo -u rental env $(cat /etc/rental-reminder/rental.env | xargs) npx prisma migrate deploy
sudo -u rental npm run build
sudo -u rental npm prune --omit=dev
```

Perintah `npm run build` menjalankan Prisma generate dan build Tailwind. Jangan menjalankan `prisma migrate dev` atau `prisma migrate reset` di production.

## 7. systemd

`/etc/systemd/system/rental-reminder.service`:

```ini
[Unit]
Description=Rental Reminder
After=network.target

[Service]
Type=simple
User=rental
Group=rental
WorkingDirectory=/opt/rental-reminder
EnvironmentFile=/etc/rental-reminder/rental.env
ExecStart=/usr/bin/node /opt/rental-reminder/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/rental-reminder
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rental-reminder
sudo systemctl status rental-reminder
sudo journalctl -u rental-reminder -f
```

Aplikasi memakai `trust proxy = 1` ketika `NODE_ENV=production`. Pastikan hanya ada satu reverse proxy di depan aplikasi. Jika rantai proxy berbeda, sesuaikan konfigurasi sebelum production.

## 8. Nginx dan HTTPS

`/etc/nginx/sites-available/rental-reminder`:

```nginx
server {
    listen 80;
    server_name rental.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rental.example.com;

    ssl_certificate /etc/letsencrypt/live/rental.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rental.example.com/privkey.pem;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/rental-reminder /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d rental.example.com
```

HSTS hanya dikirim aplikasi jika `NODE_ENV=production` dan `APP_URL` memakai `https://`. Pastikan HTTPS sudah benar sebelum mengaktifkannya.

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

Port `3000` hanya boleh diakses dari localhost/reverse proxy, tidak dibuka ke publik.

## 10. Health check dan monitoring

- Liveness: `GET /health` — hanya status aplikasi dan uptime, tanpa detail database/environment.
- Readiness: `GET /health/ready` — memeriksa koneksi database; HTTP 503 jika belum siap.
- Dashboard: partial `/health/partial` menampilkan status aman.

Contoh monitoring eksternal:

```bash
curl -fsS https://rental.example.com/health/ready
```

Log aplikasi masuk ke journald. Jangan menaruh password, cookie, token CSRF, session ID, atau secret di log. Request logger hanya mencatat path tanpa query string.

## 11. Backup terjadwal

Gunakan `scripts/backup-sqlite.mjs` (Online Backup API `node:sqlite`), bukan menyalin file database aktif dengan `cp`.

Contoh systemd timer harian:

`/etc/systemd/system/rental-backup-daily.service`:

```ini
[Unit]
Description=Rental Reminder daily SQLite backup

[Service]
Type=oneshot
User=rental
Group=rental
WorkingDirectory=/opt/rental-reminder
EnvironmentFile=/etc/rental-reminder/rental.env
Environment=BACKUP_KIND=daily
ExecStart=/usr/bin/node /opt/rental-reminder/scripts/backup-sqlite.mjs
```

`/etc/systemd/system/rental-backup-daily.timer`:

```ini
[Unit]
Description=Daily Rental Reminder backup

[Timer]
OnCalendar=*-*-* 02:15:00
Persistent=true

[Install]
WantedBy=timers.target
```

Buat timer serupa untuk `weekly` (misalnya Minggu 02:30) dan `monthly` (tanggal 1 02:45), dengan `BACKUP_KIND` berbeda. Retensi default: 7 harian, 4 mingguan, 3 bulanan. Backup lama hanya dihapus setelah backup baru lolos `integrity_check` dan `foreign_key_check`.

Simpan salinan offsite (objek storage/backup server) secara terpisah. Backup lokal saja tidak melindungi dari kehilangan server.

## 12. Upgrade aplikasi

1. Backup dan verifikasi.
2. Hentikan aplikasi.
3. Ambil source versi baru.
4. `npm ci`.
5. `npx prisma migrate deploy`.
6. `npm run build`.
7. `npm prune --omit=dev`.
8. Jalankan `npm run db:check`.
9. Start aplikasi.
10. Verifikasi login, tagihan, pembayaran, reminder, laporan, dan health.

Jangan menjalankan migrasi yang merusak data tanpa backup yang sudah diverifikasi.

## 13. Rollback

Jika build baru gagal:

1. Hentikan service.
2. Simpan database saat ini sebagai recovery copy.
3. Kembalikan source ke rilis sebelumnya.
4. Jika migrasi database tidak kompatibel, restore backup yang dibuat sebelum upgrade.
5. `npm ci`, build, lalu start.
6. Verifikasi health dan data.

Restore database mengikuti [backup-restore.md](backup-restore.md). Jangan menimpa database aktif tanpa menghentikan aplikasi.

## 14. Catatan SQLite production

- WAL diaktifkan saat startup dengan `PRAGMA journal_mode=WAL`; `busy_timeout` default 5000 ms.
- Database harus berada di filesystem lokal yang mendukung locking SQLite. Jangan gunakan NFS/SMB.
- Jangan menyalin `rental.db` saat aplikasi aktif tanpa memakai backup API; file WAL/SHM harus diperhitungkan.
- Satu instance saja. Rate limit dan scheduler lock tidak dibagi antar-proses.
- Backup, restore, integrity check, dan recovery test didokumentasikan di [backup-restore.md](backup-restore.md).
- Hasil pengujian performa ada di [performance.md](performance.md).
