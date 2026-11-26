-- BEAN Classroom Intelligence (CI-6C): independent credential verification.
-- Additive only — one new append-only table. No existing table/column is
-- altered. Verification decisions are HUMAN, server-side and auditable; a
-- record verifies ONE credential examination and never by itself changes the
-- reviewer lifecycle (that remains the strict CI-5B transition table) or the
-- content-approval authorities (CI-4C/CI-5D/CI-5E).
--
-- Honest method vocabulary — no third-party verification result is ever
-- fabricated: DOCUMENT_EXAMINATION (an authorised administrator examined the
-- uploaded evidence), ISSUING_BODY_REFERENCE (checked with the issuing body
-- through a permitted channel), PUBLISHED_REGISTRY (checkable in a public
-- professional registry, reference recorded).

CREATE TABLE "ExpertVerificationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    -- DEGREE | CERTIFICATION | LICENCE | EMPLOYMENT | PUBLICATION | REFERENCE | OTHER
    "credentialType" TEXT NOT NULL,
    "issuingInstitution" TEXT NOT NULL,
    -- What the credential covers (domain ids and/or language tags), as text.
    "qualificationScope" TEXT NOT NULL,
    -- JSON string[] of ExpertCredentialEvidence ids examined for this decision.
    "evidenceIds" TEXT NOT NULL DEFAULT '[]',
    -- DOCUMENT_EXAMINATION | ISSUING_BODY_REFERENCE | PUBLISHED_REGISTRY
    "verificationMethod" TEXT NOT NULL,
    -- Registry/reference detail when the method used an external check.
    "referenceDetail" TEXT,
    -- VERIFIED | REJECTED | NEEDS_MORE_EVIDENCE | SUPERSEDED
    "decision" TEXT NOT NULL,
    -- Required for every decision — especially adverse or changed ones.
    "reason" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "verifiedByAdminId" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ExpertVerificationRecord_profileId_createdAt_idx" ON "ExpertVerificationRecord"("profileId", "createdAt");
