-- BEAN Classroom Intelligence (CI-6B): real expert application and onboarding.
-- Additive only — three new columns on ExpertReviewerProfile and two new
-- tables. No existing column is altered, no row is touched, no data loss path
-- exists. Statuses/vocabularies are enforced server-side (SQLite has no enums).

-- Application detail: institution/professional affiliation where applicable,
-- and the applicant's selected specialties within their proposed domains
-- (advisory — the admin-approved scope stays the authority).
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "institutionAffiliation" TEXT;
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "specialtiesJson" TEXT NOT NULL DEFAULT '[]';

-- Explicit consent: the applicant reviewed the exact information submitted and
-- its intended use (credential verification + reviewer process) and consented.
-- Recorded as a CONSENT_RECORDED reviewer event plus this timestamp.
ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "applicationConsentAt" DATETIME;

-- Supporting credential evidence metadata. Files live in the RESTRICTED
-- evidence store (db/evidence/, mode 0600, never web-served by ordinary
-- profile endpoints); this table stores metadata + content hash only.
-- Possession of a document is never treated as proof of its authenticity.
-- FK-less on purpose: the audit trail survives account deletion (CI-5 rule).
CREATE TABLE "ExpertCredentialEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "retentionState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "purgedAt" DATETIME,
    "purgedReason" TEXT,
    "uploadedByStudentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ExpertCredentialEvidence_profileId_createdAt_idx" ON "ExpertCredentialEvidence"("profileId", "createdAt");

-- Administrator request for additional information/evidence during
-- application review. The applicant answers in place; both directions are
-- audited via the append-only reviewer event ledger.
CREATE TABLE "ExpertApplicationInfoRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "responseText" TEXT,
    "requestedByAdminId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "ExpertApplicationInfoRequest_profileId_status_idx" ON "ExpertApplicationInfoRequest"("profileId", "status");
