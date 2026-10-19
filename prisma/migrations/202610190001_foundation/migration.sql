-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "platformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "contact" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geoSource" TEXT NOT NULL DEFAULT 'DECLARED',
    "contactInstructions" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "capacityValue" DECIMAL(12,3) NOT NULL,
    "capacityUnit" TEXT NOT NULL,
    "serviceRadiusKm" DOUBLE PRECISION NOT NULL,
    "acceptedCategories" TEXT[],
    "specialHandlingCapabilities" TEXT[],
    "availableFrom" TIMESTAMP(3) NOT NULL,
    "availableUntil" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "RecipientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "donorOrganizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "quantityValue" DECIMAL(12,3) NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "declaredWeightKg" DECIMAL(12,3),
    "packaging" TEXT NOT NULL,
    "allergensNote" TEXT NOT NULL DEFAULT '',
    "handlingDeclaration" TEXT NOT NULL,
    "storageRequirements" TEXT NOT NULL DEFAULT 'AMBIENT',
    "pickupStart" TIMESTAMP(3) NOT NULL,
    "pickupEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityEvaluation" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "recipientOrganizationId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "routeProvider" TEXT NOT NULL DEFAULT 'HAVERSINE_OR_UNAVAILABLE',
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "EligibilityEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "recipientOrganizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pickup" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "recipientOrganizationId" TEXT NOT NULL,
    "dispatcherUserId" TEXT,
    "pickupStart" TIMESTAMP(3) NOT NULL,
    "pickupEnd" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "failureReason" TEXT,

    CONSTRAINT "Pickup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handover" (
    "id" TEXT NOT NULL,
    "pickupId" TEXT NOT NULL,
    "donorActorId" TEXT NOT NULL,
    "receiverActorId" TEXT,
    "verifiedQuantityValue" DECIMAL(12,3) NOT NULL,
    "verifiedQuantityUnit" TEXT NOT NULL,
    "verifiedWeightKg" DECIMAL(12,3),
    "discrepancyReason" TEXT,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "receiverConfirmedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "receiptReference" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL DEFAULT 'TWO_PARTY_OTP',
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverAttempt" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "successful" BOOLEAN NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "organizationId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldState" TEXT,
    "newState" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idempotency" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientProfile_organizationId_key" ON "RecipientProfile"("organizationId");

-- CreateIndex
CREATE INDEX "Lot_donorOrganizationId_status_pickupEnd_idx" ON "Lot"("donorOrganizationId", "status", "pickupEnd");

-- CreateIndex
CREATE INDEX "Lot_status_pickupEnd_idx" ON "Lot"("status", "pickupEnd");

-- CreateIndex
CREATE INDEX "EligibilityEvaluation_lotId_recipientOrganizationId_idx" ON "EligibilityEvaluation"("lotId", "recipientOrganizationId");

-- CreateIndex
CREATE INDEX "Offer_recipientOrganizationId_status_idx" ON "Offer"("recipientOrganizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_lotId_recipientOrganizationId_key" ON "Offer"("lotId", "recipientOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Pickup_lotId_key" ON "Pickup"("lotId");

-- CreateIndex
CREATE INDEX "Pickup_dispatcherUserId_status_idx" ON "Pickup"("dispatcherUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_pickupId_key" ON "Handover"("pickupId");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_receiptReference_key" ON "Handover"("receiptReference");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Idempotency_actorId_key_key" ON "Idempotency"("actorId", "key");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientProfile" ADD CONSTRAINT "RecipientProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_donorOrganizationId_fkey" FOREIGN KEY ("donorOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityEvaluation" ADD CONSTRAINT "EligibilityEvaluation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_recipientOrganizationId_fkey" FOREIGN KEY ("recipientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_recipientOrganizationId_fkey" FOREIGN KEY ("recipientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverAttempt" ADD CONSTRAINT "HandoverAttempt_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "Handover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants beyond Prisma's schema DSL.
ALTER TABLE "Organization" ADD CHECK (type IN ('DONOR','RECIPIENT','LOGISTICS')), ADD CHECK ("verificationStatus" IN ('PENDING','VERIFIED','SUSPENDED'));
ALTER TABLE "Membership" ADD CHECK (role IN ('DONOR_MANAGER','RECIPIENT_MANAGER','DISPATCHER'));
ALTER TABLE "Lot" ADD CHECK ("quantityValue">0), ADD CHECK ("quantityUnit" IN ('MEAL','KG','ITEM')), ADD CHECK ("pickupEnd">"pickupStart"), ADD CHECK ("declaredWeightKg" IS NULL OR "declaredWeightKg">0), ADD CHECK (status IN ('DRAFT','OPEN','RESERVED','PICKUP_IN_PROGRESS','HANDED_OVER','EXPIRED','CANCELED'));
ALTER TABLE "RecipientProfile" ADD CHECK ("capacityValue">0 AND "serviceRadiusKm">0), ADD CHECK ("availableUntil">"availableFrom"), ADD CHECK ("capacityUnit" IN ('MEAL','KG','ITEM'));
ALTER TABLE "Offer" ADD CHECK (status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','SUPERSEDED'));
CREATE UNIQUE INDEX "one_accepted_offer_per_lot" ON "Offer" ("lotId") WHERE status='ACCEPTED';
ALTER TABLE "Pickup" ADD CHECK (status IN ('REQUESTED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED','COMPLETED','FAILED','CANCELED'));
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_dispatcher_fkey" FOREIGN KEY ("dispatcherUserId") REFERENCES "User"(id);
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id);
ALTER TABLE "EligibilityEvaluation" ADD CONSTRAINT "Evaluation_recipient_fkey" FOREIGN KEY ("recipientOrganizationId") REFERENCES "Organization"(id);
ALTER TABLE "Handover" ADD CHECK ("verifiedQuantityValue">0), ADD CHECK ("verifiedWeightKg" IS NULL OR "verifiedWeightKg">0), ADD CHECK (status IN ('PENDING','VERIFIED')), ADD CHECK (status<>'VERIFIED' OR ("verifiedAt" IS NOT NULL AND "receiverConfirmedAt" IS NOT NULL AND "receiverActorId" IS NOT NULL AND "receiverActorId"<>"donorActorId"));
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_donor_fkey" FOREIGN KEY ("donorActorId") REFERENCES "User"(id), ADD CONSTRAINT "Handover_receiver_fkey" FOREIGN KEY ("receiverActorId") REFERENCES "User"(id);
CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION protect_audit();
CREATE FUNCTION protect_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status='VERIFIED' THEN RAISE EXCEPTION 'Verified handovers are immutable'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER handover_immutable BEFORE UPDATE OR DELETE ON "Handover" FOR EACH ROW EXECUTE FUNCTION protect_receipt();
