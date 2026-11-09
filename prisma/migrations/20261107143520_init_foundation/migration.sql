-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "whatsappNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "business_members_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "business_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "businesses_name_idx" ON "businesses"("name");

-- CreateIndex
CREATE INDEX "business_members_userId_idx" ON "business_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_businessId_userId_key" ON "business_members"("businessId", "userId");
