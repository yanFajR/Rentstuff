# Panduan Laporan & Export CSV

Modul laporan menyajikan data aktual bisnis aktif. Semua route dilindungi login dan `TenantAuthGuard`.

## 1. Halaman dan tab

`GET /reports?tab=summary|rentals|invoices|payments|receivables|reminders`

- **Ringkasan** — invoice diterbitkan, pembayaran diterima, outstanding saat ini, jumlah/status invoice, perbandingan pembayaran dengan periode sebelumnya, dan tren enam bulan.
- **Transaksi Rental** — transaksi berdasarkan `startDate`, dengan total invoice historis, pembayaran valid, dan outstanding.
- **Invoice & Tagihan** — invoice berdasarkan `issueDate`, status turunan, filter jatuh tempo, pencarian, dan ringkasan status.
- **Pembayaran** — pembayaran berdasarkan `paymentDate`, metode, status valid/void, dan ringkasan per metode.
- **Piutang** — snapshot invoice aktif dengan outstanding > 0, kelompok umur, hari keterlambatan, tautan invoice/pengingat.
- **Reminder** — job berdasarkan `scheduledDate`, status job, aktivitas WhatsApp, waktu, dan pelaku.

## 2. Periode

Pilihan periode:

- Hari ini
- 7 hari terakhir
- 30 hari terakhir
- Bulan ini (default)
- Bulan sebelumnya
- Tahun ini
- Rentang tanggal custom

Batas awal dan akhir inklusif. Perhitungan memakai kalender `Asia/Jakarta`, bukan timezone server. Custom yang tidak lengkap/terbalik menampilkan error; export dengan custom tidak valid mengembalikan HTTP 400.

Basis tanggal:

| Laporan              | Basis                                       |
| -------------------- | ------------------------------------------- |
| Ringkasan invoice    | `issueDate`                                 |
| Ringkasan pembayaran | `paymentDate`                               |
| Rental               | `startDate`                                 |
| Invoice              | `issueDate`                                 |
| Pembayaran           | `paymentDate`                               |
| Piutang              | Snapshot saat ini (periode tidak membatasi) |
| Reminder             | `scheduledDate`                             |

Periode pembanding memakai rentang sepanjang periode aktif tepat sebelum tanggal awal.

## 3. Definisi perhitungan

- **Total invoice diterbitkan** = jumlah `invoices.totalAmount` dengan `issueDate` dalam periode; `CANCELLED` dikecualikan.
- **Total pembayaran diterima** = jumlah `payments.amount` dengan `paymentDate` dalam periode dan `voidedAt = null`.
- **Outstanding** = total invoice aktif saat laporan dibuat dikurangi seluruh pembayaran valid pada invoice aktif. Bukan selisih transaksi dalam periode.
- **Status invoice** dihitung backend: `CANCELLED → PAID → OVERDUE → PARTIAL → UNPAID`.
- **Status rental** tetap `ACTIVE/COMPLETED/CANCELLED`.
- **Piutang** hanya invoice aktif dengan outstanding > 0. Kelompok: belum jatuh tempo, jatuh tempo hari ini, terlambat 1–7, 8–30, >30 hari.
- **Hari terlambat** = selisih tanggal kalender Jakarta, minimal 0.
- **Reminder** `OPENED` berarti WhatsApp dibuka; `SENT` adalah konfirmasi manual pengguna, bukan bukti terkirim/dibaca.

Invoice CANCELLED tetap dapat muncul di daftar invoice dengan status Dibatalkan, tetapi tidak masuk total tagihan aktif, outstanding, atau piutang.

## 4. Export CSV

Route:

`GET /reports/export/{rentals|invoices|payments|receivables|reminders}`

Nama file:

- `laporan-transaksi-rental-YYYY-MM-DD.csv`
- `laporan-invoice-YYYY-MM-DD.csv`
- `laporan-pembayaran-YYYY-MM-DD.csv`
- `laporan-piutang-YYYY-MM-DD.csv`
- `laporan-reminder-YYYY-MM-DD.csv`

Karakteristik:

- UTF-8 dengan BOM agar kompatibel dengan Excel.
- Pemisah koma, baris CRLF.
- Header Bahasa Indonesia.
- Tanggal `YYYY-MM-DD`; waktu aktivitas `YYYY-MM-DD HH:mm:ss` Jakarta.
- Nominal berupa angka mentah tanpa pemisah ribuan.
- Filter aktif diterapkan dan seluruh hasil diekspor, bukan hanya halaman pagination.
- Pembacaan memakai batch cursor 200 baris dengan backpressure.
- Nilai teks yang dimulai `=`, `+`, `-`, `@`, tab, atau carriage return diberi apostrof untuk mencegah formula injection; angka tidak diubah.
- Koma, tanda kutip, newline, dan Unicode di-escape dengan benar.

Export hanya membaca data; tidak mengubah database.

## 5. Performa dan batasan

- Ringkasan memakai agregasi Prisma untuk outstanding/pembayaran; data invoice periode dimuat terbatas pada periode.
- Tabel rental/pembayaran/reminder memakai pagination database.
- Invoice dengan filter status dan laporan piutang menghitung status/outstanding di aplikasi karena nilainya tidak disimpan; kandidat dimuat sebelum pagination. Untuk volume besar, ini perlu materialisasi/cache di tahap berikutnya.
- Export memakai batch cursor, tetapi filter status invoice/piutang tetap diproses per baris.
- Tidak ada dependency chart; visualisasi memakai bar HTML/CSS sederhana berbasis data aktual.
- Laporan piutang adalah snapshot; periode tidak membatasi daftar.
- Tidak ada raw SQL spesifik SQLite pada laporan.
