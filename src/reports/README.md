# Modul Reports

Status: selesai (Tahap 6).

Tanggung jawab:

- Laporan ringkasan keuangan, transaksi rental, invoice, pembayaran, piutang, dan reminder.
- Filter periode Asia/Jakarta, filter tab, pencarian, sorting, pagination.
- Export CSV aman dengan BOM, escaping, proteksi formula injection, batch cursor, dan filter aktif.
- Semua query dibatasi `businessId` dari `TenantAuthGuard`.

File utama:

- `reports.controller.ts` — halaman `/reports` dan `/reports/export/:type`.
- `reports.service.ts` — query, agregasi, ringkasan, dan generator CSV.
- `report-period.ts` — preset periode, validasi custom, rentang pembanding.
- `report-calculations.ts` — ringkasan invoice/rental, aging piutang.
- `report-csv.ts` — escaping, BOM, streaming, formula injection.
- `report-types.ts` — tipe data laporan.
- `reports.module.ts` — modul NestJS.

Lihat [docs/reports.md](../../docs/reports.md) untuk definisi perhitungan dan batasan.
