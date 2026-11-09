import type { Agent } from './cookies.js';
import { extractCsrfToken, fetchCsrfToken } from './cookies.js';

export interface CustomerInput {
  name?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface CreatedCustomer {
  id: string;
  name: string;
  whatsappNumber: string;
  email: string;
  address: string;
  notes: string;
}

export async function createCustomer(
  agent: Agent,
  overrides: CustomerInput = {},
): Promise<CreatedCustomer> {
  const csrfToken = await fetchCsrfToken(agent, '/customers/new');
  const values = {
    name: overrides.name ?? 'Budi Santoso',
    whatsappNumber: overrides.whatsappNumber ?? '0812-3456-7890',
    email: overrides.email ?? '',
    address: overrides.address ?? '',
    notes: overrides.notes ?? '',
  };

  const response = await agent
    .post('/customers')
    .type('form')
    .send({ _csrf: csrfToken, ...values })
    .expect(303);

  const location = response.headers.location;
  const id = location.split('/').pop() ?? '';

  return { id, ...values };
}

export interface RentalInput {
  customerId: string;
  itemName?: string;
  startDate?: string;
  endDate?: string;
  price?: string;
  notes?: string;
}

export interface CreatedRental {
  id: string;
  customerId: string;
  itemName: string;
  startDate: string;
  endDate: string;
  price: string;
  notes: string;
}

export async function createRental(agent: Agent, input: RentalInput): Promise<CreatedRental> {
  const csrfToken = await fetchCsrfToken(agent, '/rentals/new');
  const values = {
    customerId: input.customerId,
    itemName: input.itemName ?? 'Toyota Avanza 2022',
    startDate: input.startDate ?? '2026-11-08',
    endDate: input.endDate ?? '2026-11-10',
    price: input.price ?? '1500000',
    notes: input.notes ?? '',
  };

  const response = await agent
    .post('/rentals')
    .type('form')
    .send({ _csrf: csrfToken, ...values })
    .expect(303);

  const location = response.headers.location;
  const id = location.split('/').pop() ?? '';

  return { id, ...values };
}

export async function submitForm(
  agent: Agent,
  pagePath: string,
  action: string,
  payload: Record<string, string>,
): Promise<{ status: number; location: string | undefined; text: string; csrfToken: string }> {
  const csrfToken = await fetchCsrfToken(agent, pagePath);
  const response = await agent
    .post(action)
    .type('form')
    .send({ _csrf: csrfToken, ...payload });

  return {
    status: response.status,
    location: response.headers.location as string | undefined,
    text: response.text,
    csrfToken,
  };
}

export function csrfFrom(html: string): string {
  return extractCsrfToken(html);
}

export interface InvoiceInput {
  rentalRecordId: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: string;
  description?: string;
  notes?: string;
}

export interface CreatedInvoice {
  id: string;
  rentalRecordId: string;
  issueDate: string;
  dueDate: string;
  totalAmount: string;
  description: string;
  notes: string;
}

export async function createInvoice(agent: Agent, input: InvoiceInput): Promise<CreatedInvoice> {
  const csrfToken = await fetchCsrfToken(agent, '/invoices/new');
  const values = {
    rentalRecordId: input.rentalRecordId,
    issueDate: input.issueDate ?? '2026-11-08',
    dueDate: input.dueDate ?? '2099-12-31',
    totalAmount: input.totalAmount ?? '1500000',
    description: input.description ?? '',
    notes: input.notes ?? '',
  };

  const response = await agent
    .post('/invoices')
    .type('form')
    .send({ _csrf: csrfToken, ...values })
    .expect(303);

  const id = response.headers.location.split('/').pop() ?? '';

  return { id, ...values };
}

export interface PaymentInput {
  amount?: string;
  paymentDate?: string;
  method?: string;
  reference?: string;
  notes?: string;
}

export async function createPayment(
  agent: Agent,
  invoiceId: string,
  input: PaymentInput = {},
): Promise<{ location: string | undefined; values: Required<PaymentInput> }> {
  const csrfToken = await fetchCsrfToken(agent, `/invoices/${invoiceId}/payments/new`);
  const values: Required<PaymentInput> = {
    amount: input.amount ?? '500000',
    paymentDate: input.paymentDate ?? '2026-11-10',
    method: input.method ?? 'BANK_TRANSFER',
    reference: input.reference ?? 'TRX-TEST',
    notes: input.notes ?? '',
  };

  const response = await agent
    .post(`/invoices/${invoiceId}/payments`)
    .type('form')
    .send({ _csrf: csrfToken, ...values })
    .expect(303);

  return { location: response.headers.location, values };
}
