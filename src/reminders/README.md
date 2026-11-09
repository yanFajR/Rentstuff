# Modul Reminders

Modul ini membuat, menyimpan, dan menindaklanjuti pengingat pembayaran invoice. Tidak ada pengiriman WhatsApp otomatis; pengguna membuka `wa.me` dan menandai sendiri bahwa pesan sudah dikirim.

## File utama

| File                            | Fungsi                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| `reminder-rules.ts`             | Aturan H-3/H-1/DUE_DATE/H+1, timezone, status job, perencanaan tanggal |
| `reminder-status.ts`            | Label/kelas status, kategori jatuh tempo, aktivitas, kontak            |
| `reminder-message.ts`           | Pesan WhatsApp sopan + URL `wa.me` dengan encoding                     |
| `reminder-scheduler.service.ts` | Rekonsiliasi, pembuatan job, anti-duplikasi, reaktivasi                |
| `reminder.scheduler.ts`         | Cron harian `0 9 * * *` dengan `timeZone: Asia/Jakarta`                |
| `reminder.service.ts`           | Daftar/detail, ringkasan dashboard, aksi WhatsApp, tandai terkirim     |
| `reminder.controller.ts`        | Route SSR `/reminders`, aksi POST, pemicu manual development           |
| `run-reminders.ts`              | CLI `npm run reminders:run` untuk semua bisnis                         |
| `dto/reminder-action.dto.ts`    | Validasi catatan tindak lanjut                                         |

## Status

Job:

- `PENDING` — jadwal masih akan datang.
- `READY` — jadwal tiba dan reminder dapat dihubungi.
- `SKIPPED` — tidak lagi relevan (lunas, dibatalkan, atau due date berubah). Alasan disimpan, job tidak dihapus.

Kontak (diturunkan dari aktivitas, bukan kolom status):

- `PENDING` — belum ada aktivitas.
- `OPENED` — pengguna membuka WhatsApp.
- `SENT` — pengguna menandai sudah dikirim secara manual.

## Alur scheduler

1. Rekonsiliasi job aktif: lunas/dibatalkan → `SKIPPED`; due date berubah → `SKIPPED`.
2. Promosikan job `PENDING` yang jadwalnya sudah tiba menjadi `READY`.
3. Cari invoice dengan due date H-1..H+3 dari hari ini.
4. Hitung outstanding dari pembayaran valid; lewati invoice lunas/dibatalkan.
5. Buat job yang belum ada untuk aturan H-3/H-1/DUE_DATE/H+1.
6. Unique `(invoiceId, reminderType, scheduledDate)` mencegah duplikasi meskipun scheduler berjalan ulang atau lebih dari satu instance.
7. Job yang `SKIPPED` karena lunas/dibatalkan dapat diaktifkan kembali jika invoice kembali memiliki sisa tagihan (mis. pembayaran di-void), dengan aktivitas `REACTIVATED`.

Lock in-process mencegah dua eksekusi scheduler paralel pada satu proses. Error pada satu invoice dicatat dan tidak menghentikan invoice berikutnya.

## WhatsApp manual

- Nomor pelanggan dinormalisasi ke `628xx` dan divalidasi.
- Pesan memuat nama pelanggan, nomor invoice, nama bisnis, outstanding terbaru, dan tanggal jatuh tempo.
- Membuka WhatsApp mencatat `WHATSAPP_OPENED`, bukan `SENT`.
- `SENT` hanya lewat tombol **Tandai sudah dikirim** dengan konfirmasi.
- Reminder `SKIPPED`, invoice lunas, atau invoice dibatalkan tidak dapat membuka WhatsApp.
- Tidak ada WhatsApp Cloud API, pengiriman otomatis, atau klaim bahwa pesan terkirim tanpa aksi pengguna.

## Keamanan

- Semua route memakai `TenantAuthGuard`.
- `businessId` hanya dari session; body/query/params yang mencoba menyuplai `businessId` ditolak 403.
- `userId` aktivitas dari session, bukan body.
- Reminder/job tenant lain → 404.
- Semua POST memakai CSRF.
- Pemicu manual hanya tersedia di non-production, tetap memakai login + CSRF; di production route mengembalikan 404.
- Riwayat aktivitas append-only; tidak ada route hapus.

## Keterbatasan MVP

- Scheduler satu instance; belum ada distributed lock/queue.
- Rekonsiliasi memuat job aktif dalam satu query; perlu batching bila volume job sangat besar.
- Pemicu manual memproses bisnis pengguna; CLI memproses semua bisnis.
- Belum ada preferensi aturan per bisnis; aturan global.
- Belum ada WhatsApp Cloud API, SMS, email, atau pengiriman otomatis.
- Aktivitas koreksi/void reminder belum memiliki aksi UI terpisah; riwayat tetap lengkap dan tidak dihapus.
