-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastCounter" BIGINT,
ADD COLUMN     "mfaPendingSecret" TEXT,
ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "recoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ActionToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "organizationId" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOutbox" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "MailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingPolicy" (
    "id" TEXT NOT NULL DEFAULT 'active',
    "capacityWeight" INTEGER NOT NULL DEFAULT 35,
    "windowWeight" INTEGER NOT NULL DEFAULT 35,
    "distanceWeight" INTEGER NOT NULL DEFAULT 30,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "pickupId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionToken_tokenHash_key" ON "ActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ActionToken_userId_kind_expiresAt_idx" ON "ActionToken"("userId", "kind", "expiresAt");

-- CreateIndex
CREATE INDEX "ActionToken_organizationId_kind_idx" ON "ActionToken"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "MailOutbox_status_availableAt_idx" ON "MailOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "Dispute_organizationId_createdAt_idx" ON "Dispute"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionToken" ADD CHECK (kind IN ('RESET','VERIFY','INVITE'));
ALTER TABLE "MailOutbox" ADD CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')), ADD CHECK (attempts>=0);
ALTER TABLE "MatchingPolicy" ADD CHECK ("capacityWeight">=0 AND "windowWeight">=0 AND "distanceWeight">=0 AND "capacityWeight"+"windowWeight"+"distanceWeight"=100 AND "capacityWeight"+"windowWeight">0);
ALTER TABLE "Dispute" ADD CHECK (status IN ('OPEN','RESOLVED')), ADD CONSTRAINT "Dispute_pickup_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"(id), ADD CONSTRAINT "Dispute_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id), ADD CONSTRAINT "Dispute_user_fkey" FOREIGN KEY ("openedById") REFERENCES "User"(id);
