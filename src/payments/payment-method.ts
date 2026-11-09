export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'E_WALLET', 'OTHER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Tunai',
  BANK_TRANSFER: 'Transfer Bank',
  E_WALLET: 'E-Wallet',
  OTHER: 'Lainnya',
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}
