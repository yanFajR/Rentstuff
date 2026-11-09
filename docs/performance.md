# Performance Test — Tahap 7

Pengujian ini memakai data QA sintetis, build production (`node dist/main.js`), SQLite WAL, dan bukan benchmark production absolut. Angka dapat berbeda berdasarkan CPU, disk, dan cache OS.

## 1. Dataset

| Data              | Jumlah |
| ----------------- | ------ |
| Customer          | 1.000  |
| Rental            | 5.000  |
| Invoice           | 10.000 |
| Payment           | 20.000 |
| Reminder job      | 10.000 |
| Reminder activity | 30.000 |

Ukuran database setelah seed dan scheduler: sekitar **41,4 MB**.

Seed dapat diulang dengan:

```bash
DATABASE_URL="file:./perf.db" npx prisma migrate deploy
DATABASE_URL="file:./perf.db" npm run perf:seed
```

Script seed menolak `NODE_ENV=production` kecuali `PERFORMANCE_ALLOW_PRODUCTION=1`; jangan jalankan pada database production.

## 2. Lingkungan pengujian

- Windows, Node.js 26.13.0.
- Build production NestJS.
- SQLite `journal_mode=WAL`, `busy_timeout=5000`.
- Satu instance aplikasi.
- Server QA terpisah dari database test E2E.

## 3. Hasil endpoint

Diukur setelah login, satu request per endpoint, response HTML/CSV dibaca penuh.

| Endpoint                          | Status  | Waktu    | Ukuran respons |
| --------------------------------- | ------- | -------- | -------------- |
| Dashboard                         | 200     | 1.878 ms | 76.752 B       |
| Customer list                     | 200     | 84 ms    | 42.537 B       |
| Rental list                       | 200     | 32 ms    | 47.189 B       |
| Invoice list                      | 200     | 26 ms    | 53.755 B       |
| Payment list                      | 200     | 25 ms    | 44.720 B       |
| Reminder list                     | 200     | 1.114 ms | 62.973 B       |
| Report ringkasan                  | 200     | 626 ms   | 36.499 B       |
| Report rental                     | 200     | 23 ms    | 57.410 B       |
| Report invoice                    | 200     | 131 ms   | 55.709 B       |
| Report pembayaran                 | 200     | 57 ms    | 54.933 B       |
| Report piutang                    | 200     | 3.455 ms | 60.654 B       |
| Report reminder                   | 200     | 100 ms   | 54.767 B       |
| CSV invoice                       | 200     | 437 ms   | 98.074 B       |
| CSV pembayaran                    | 200     | 1.761 ms | 580.231 B      |
| Dashboard + CSV invoice bersamaan | 200/200 | 2.987 ms | 174.826 B      |

Memori proses server setelah rangkaian request berat: sekitar **314 MB RSS**. Angka ini termasuk cache query engine dan tidak boleh dibaca sebagai baseline idle.

## 4. Scheduler

Sebelum optimasi: **51,78 detik** untuk 10.000 job, dengan ribuan transaksi skip satu per satu.

Setelah batching skip/reactivate/promote: **19,05 detik** pada dataset yang sama, 0 error. Hasil satu run:

```text
1344 dibuat, 12 menjadi siap, 6591 dilewati, 38 diaktifkan kembali, 0 error.
```

Scheduler tetap berjalan harian 09.00 Asia/Jakarta. Karena SQLite menulis serial, scheduler sebaiknya tidak dijalankan bersamaan dengan batch import/export besar. Tidak ada error `SQLITE_BUSY` pada pengujian ini.

## 5. Optimasi yang dilakukan

1. **Receivables**: query 10.000 invoice dengan nested payment + reminder memicu panic Prisma Query Engine pada SQLite. Diganti dengan batch cursor, agregasi pembayaran sekali, dan reminder hanya untuk 10 baris yang terlihat. Hasil: 500 → 200, waktu 7,0 detik → 3,5 detik.
2. **Scheduler**: skip/reactivate/promote dibatch 200 job per transaksi dengan `updateMany`/`createMany`, bukan satu transaksi per job. Hasil: 51,8 detik → 19,1 detik.
3. **SQLite**: WAL dan busy timeout mencegah locking error pada concurrency test.
4. **CSV**: tetap cursor batch 200 dengan backpressure; CSV pembayaran 20.000 baris selesai ~1,8 detik.

## 6. Concurrency

E2E concurrency menjalankan lima skenario nyata:

- dua pembayaran bersamaan untuk invoice yang sama;
- dua pembuatan invoice bersamaan;
- dua invocation scheduler bersamaan;
- pembayaran bersamaan dengan rekonsiliasi reminder;
- dua update profil bisnis bersamaan.

Hasil: tidak ada overpayment, nomor invoice duplikat, job reminder duplikat, data finansial hilang, atau transaksi setengah tersimpan. Tidak ada `SQLITE_BUSY` yang muncul ke pengguna pada pengujian ini.

## 7. Batasan

- Pengukuran dilakukan pada Windows QA, bukan server produksi Linux.
- Dataset sintetis, bukan pola data pelanggan nyata.
- Belum ada load test paralel puluhan pengguna; ini bukan pengganti uji beban.
- Report piutang masih memuat seluruh invoice aktif untuk menghitung bucket/aging; 3,5 detik pada 10.000 invoice adalah batas atas yang perlu dipantau.
- Scheduler 19 detik untuk 10.000 job adalah operasi harian; jangan menjalankan scheduler manual berulang saat jam sibuk.
- Jika volume tumbuh jauh lebih besar, evaluasi indeks/agregasi SQL atau arsitektur database pada tahap mendatang.
