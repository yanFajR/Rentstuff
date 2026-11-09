-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "rentalRecordId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "invoices_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invoices_rentalRecordId_fkey" FOREIGN KEY ("rentalRecordId") REFERENCES "rental_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentDate" DATETIME NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "voidedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "payments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "invoices_businessId_issueDate_idx" ON "invoices"("businessId", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_businessId_dueDate_idx" ON "invoices"("businessId", "dueDate");

-- CreateIndex
CREATE INDEX "invoices_businessId_createdAt_idx" ON "invoices"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_businessId_rentalRecordId_idx" ON "invoices"("businessId", "rentalRecordId");

-- CreateIndex
CREATE INDEX "invoices_rentalRecordId_idx" ON "invoices"("rentalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_businessId_invoiceNumber_key" ON "invoices"("businessId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "payments_businessId_invoiceId_idx" ON "payments"("businessId", "invoiceId");

-- CreateIndex
CREATE INDEX "payments_businessId_paymentDate_idx" ON "payments"("businessId", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_businessId_createdAt_idx" ON "payments"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_recordedByUserId_idx" ON "payments"("recordedByUserId");
