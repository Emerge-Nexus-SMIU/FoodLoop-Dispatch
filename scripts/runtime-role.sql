-- Run as migration administrator after migrations, against the intended database.
-- First create a dedicated LOGIN role with your provider's secure credential UI:
-- role name: foodloop_runtime. Do not paste passwords into Git or SQL logs.
GRANT USAGE ON SCHEMA public TO foodloop_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "Session", "Organization", "Membership", "Location", "RecipientProfile", "Lot", "EligibilityEvaluation", "Offer", "Pickup", "Handover", "HandoverAttempt", "Idempotency", "RateLimit", "Notification", "ActionToken", "MailOutbox", "MatchingPolicy", "Dispute" TO foodloop_runtime;
GRANT SELECT, INSERT ON "AuditEvent" TO foodloop_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM foodloop_runtime;
REVOKE CREATE ON SCHEMA public FROM foodloop_runtime;
-- Never grant schema/table ownership, SUPERUSER, BYPASSRLS or membership of the migration owner.
-- Verified Handover trigger remains in force on UPDATE/DELETE; runtime role does not own it.
