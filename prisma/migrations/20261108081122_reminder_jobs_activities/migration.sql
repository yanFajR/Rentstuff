-- CreateTable
CREATE TABLE "reminder_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "scheduledDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedAt" DATETIME,
    "skippedAt" DATETIME,
    "skipReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reminder_jobs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reminder_jobs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reminder_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "userId" TEXT,
    "activityType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_activities_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reminder_activities_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "reminder_jobs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reminder_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "reminder_jobs_businessId_status_scheduledDate_idx" ON "reminder_jobs"("businessId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX "reminder_jobs_businessId_scheduledDate_idx" ON "reminder_jobs"("businessId", "scheduledDate");

-- CreateIndex
CREATE INDEX "reminder_jobs_invoiceId_idx" ON "reminder_jobs"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_jobs_invoiceId_reminderType_scheduledDate_key" ON "reminder_jobs"("invoiceId", "reminderType", "scheduledDate");

-- CreateIndex
CREATE INDEX "reminder_activities_businessId_createdAt_idx" ON "reminder_activities"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "reminder_activities_reminderId_idx" ON "reminder_activities"("reminderId");

-- CreateIndex
CREATE INDEX "reminder_activities_userId_idx" ON "reminder_activities"("userId");
