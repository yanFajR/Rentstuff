# Backup, Restore & Integrity SQLite

Mekanisme ini memakai **SQLite Online Backup API** melalui `node:sqlite` (`backup()`), sehingga aman untuk database aktif dan memperhitungkan WAL. Jangan menggunakan `cp rental.db` pada database yang sedang dipakai.

## 1. Perintah dasar

```bash
# Backup (default daily, retensi 7)
npm run db:backup

# Jenis dan retensi
BACKUP_KIND=weekly npm run db:backup
BACKUP_KIND=monthly npm run db:backup

# Verifikasi database aktif/backup tertentu
npm run db:check
npm run db:check -- /var/backups/rental-reminder/rental-reminder-daily-20261108-021500.db

# Restore (aplikasi harus sudah berhenti)
npm run db:restore -- --backup=/var/backups/rental-reminder/rental-reminder-daily-20261108-021500.db --yes
```

Lokasi database dibaca dari `DATABASE_URL` (`file:`). Path relatif diselesaikan dari `prisma/`; production wajib memakai path absolut di luar source/build.

## 2. Lokasi, penamaan, dan permission

- Default direktori: `backups/` di root proyek untuk development.
- Production: `BACKUP_DIR=/var/backups/rental-reminder`.
- Nama: `rental-reminder-<daily|weekly|monthly>-YYYYMMDD-HHmmss.db`.
- Checksum: file `.sha256` di samping backup.
- Direktori `700`, file backup `600` (POSIX; Windows mengabaikan chmod).
- File backup tidak boleh berada di `public/`, folder build, atau direktori yang disajikan Nginx.

Retensi default:

| Jenis    | Jumlah |
| -------- | ------ |
| Harian   | 7      |
| Mingguan | 4      |
| Bulanan  | 3      |

Dapat dikonfigurasi dengan `BACKUP_DAILY_KEEP`, `BACKUP_WEEKLY_KEEP`, `BACKUP_MONTHLY_KEEP`.

Backup baru **diverifikasi terlebih dahulu** (`PRAGMA integrity_check` dan `PRAGMA foreign_key_check`). Jika verifikasi gagal, backup lama tidak dihapus.

## 3. Verifikasi backup

```bash
npm run db:check -- /path/ke/backup.db
```

Output yang diharapkan:

```json
{
  "path": "/path/ke/backup.db",
  "size": 249856,
  "integrity": "ok",
  "foreignKeyViolations": 0,
  "valid": true
}
```

Periksa juga checksum:

```bash
sha256sum -c rental-reminder-daily-YYYYMMDD-HHmmss.db.sha256
```

## 4. Backup manual yang aman

```bash
set -a
. /etc/rental-reminder/rental.env
set +a
cd /opt/rental-reminder
sudo -u rental env BACKUP_DIR=/var/backups/rental-reminder BACKUP_KIND=daily \
  /usr/bin/node scripts/backup-sqlite.mjs
```

Jangan menjalankan backup ke filesystem jaringan yang tidak mendukung locking SQLite.

## 5. Restore

Urutan yang benar:

1. Hentikan aplikasi (`systemctl stop rental-reminder`).
2. Pastikan backup ada dan lolos `npm run db:check -- <backup>`.
3. Jalankan restore; script otomatis membuat recovery copy database lama.
4. Script menghapus `-wal`/`-shm` lama, menyalin backup, lalu memverifikasi integritas.
5. Script menjalankan `prisma migrate status`.
6. Periksa hasil migrasi.
7. Start aplikasi.
8. Verifikasi login, data bisnis, pelanggan, rental, invoice, pembayaran, reminder, dan laporan.

```bash
systemctl stop rental-reminder
cd /opt/rental-reminder
sudo -u rental env $(cat /etc/rental-reminder/rental.env | xargs) \
  /usr/bin/node scripts/restore-sqlite.mjs \
  --backup=/var/backups/rental-reminder/rental-reminder-daily-YYYYMMDD-HHmmss.db --yes
systemctl start rental-reminder
curl -fsS https://rental.example.com/health/ready
```

Recovery copy diberi nama `<database>.pre-restore-YYYYMMDD-HHmmss`. Jangan menghapusnya sebelum data hasil restore diverifikasi.

Script restore **tidak** memverifikasi bahwa aplikasi sudah berhenti; hentikan service secara eksplisit. Jangan restore ke database production yang masih diakses aplikasi.

## 6. Integrity check manual

```bash
npm run db:check
```

Atau dengan SQLite CLI:

```bash
sqlite3 /var/lib/rental-reminder/rental.db "PRAGMA integrity_check;"
sqlite3 /var/lib/rental-reminder/rental.db "PRAGMA foreign_key_check;"
```

Jangan menjalankan `VACUUM`, `PRAGMA wal_checkpoint` dengan mode yang mengunci, atau maintenance lain pada jam sibuk tanpa memahami dampaknya. Backup API sudah menangani konsistensi tanpa menghentikan aplikasi.

## 7. Recovery test yang sudah dijalankan

Pada QA database (bukan production):

1. Backup dibuat dari database berisi data.
2. Nama bisnis diubah menjadi `CORRUPTED-RESTORE-TEST`.
3. Restore dijalankan dengan `--yes`.
4. Nama bisnis kembali menjadi `Rental Berkah`.
5. `PRAGMA integrity_check` = `ok`.
6. `PRAGMA foreign_key_check` = 0 pelanggaran.
7. `prisma migrate status` = schema up to date.

Hasil ini membuktikan prosedur backup/restore berjalan, tetapi bukan jaminan untuk setiap skenario kerusakan disk. Uji restore terjadwal secara berkala di lingkungan terpisah.

## 8. Backup offsite

Salin hasil backup yang sudah diverifikasi ke lokasi terpisah secara terenkripsi. Jangan hanya mengandalkan disk server yang sama. Uji restore dari salinan offsite, bukan hanya keberadaan file backup.
