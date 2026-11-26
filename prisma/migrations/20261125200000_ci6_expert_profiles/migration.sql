-- BEAN Classroom Intelligence (CI-6D): expert profiles and capability activation.
-- Additive only — six new columns on ExpertReviewerProfile. No existing column
-- is altered, no row is touched. Public expert profiles are strictly
-- consent-gated and expose ONLY the fields the expert agreed to disclose;
-- credentials, verification notes, COI text and internal audit information are
-- never public (enforced server-side by the derived public projection).

ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "profileVisibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "disclosureConsentAt" DATETIME;
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "publicDisplayName" TEXT;
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "professionalSummary" TEXT;
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "availabilityNote" TEXT;
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "disclosedAffiliation" BOOLEAN NOT NULL DEFAULT false;
