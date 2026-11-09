export interface NavigationItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  available: boolean;
}

export interface NavigationSection {
  title: string;
  items: NavigationItem[];
}

export const NAVIGATION: NavigationSection[] = [
  {
    title: 'Ringkasan',
    items: [
      {
        key: 'dashboard',
        label: 'Ringkasan',
        href: '/dashboard',
        icon: 'dashboard',
        available: true,
      },
    ],
  },
  {
    title: 'Operasional',
    items: [
      {
        key: 'customers',
        label: 'Pelanggan',
        href: '/customers',
        icon: 'users',
        available: true,
      },
      {
        key: 'rentals',
        label: 'Penyewaan',
        href: '/rentals',
        icon: 'calendar',
        available: true,
      },
      {
        key: 'invoices',
        label: 'Tagihan',
        href: '/invoices',
        icon: 'invoice',
        available: true,
      },
      {
        key: 'payments',
        label: 'Pembayaran',
        href: '/payments',
        icon: 'wallet',
        available: true,
      },
    ],
  },
  {
    title: 'Tindak lanjut',
    items: [
      {
        key: 'reminders',
        label: 'Pengingat',
        href: '/reminders',
        icon: 'bell',
        available: true,
      },
    ],
  },
  {
    title: 'Keuangan',
    items: [
      {
        key: 'reports',
        label: 'Laporan',
        href: '/reports',
        icon: 'chart',
        available: true,
      },
    ],
  },
  {
    title: 'Akun',
    items: [
      {
        key: 'settings',
        label: 'Pengaturan',
        href: '/settings',
        icon: 'settings',
        available: true,
      },
    ],
  },
];
