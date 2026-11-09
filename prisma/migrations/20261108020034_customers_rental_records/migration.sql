-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rental_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rentalNumber" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "price" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "rental_records_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rental_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "customers_businessId_name_idx" ON "customers"("businessId", "name");

-- CreateIndex
CREATE INDEX "customers_businessId_whatsappNumber_idx" ON "customers"("businessId", "whatsappNumber");

-- CreateIndex
CREATE INDEX "customers_businessId_createdAt_idx" ON "customers"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "customers_businessId_archivedAt_idx" ON "customers"("businessId", "archivedAt");

-- CreateIndex
CREATE INDEX "rental_records_businessId_status_idx" ON "rental_records"("businessId", "status");

-- CreateIndex
CREATE INDEX "rental_records_businessId_createdAt_idx" ON "rental_records"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "rental_records_businessId_startDate_idx" ON "rental_records"("businessId", "startDate");

-- CreateIndex
CREATE INDEX "rental_records_customerId_idx" ON "rental_records"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_records_businessId_rentalNumber_key" ON "rental_records"("businessId", "rentalNumber");
