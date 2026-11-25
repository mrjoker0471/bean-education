-- BEAN Classroom Intelligence (CI-5B): expert reviewer identity & qualification.
-- Additive only — creates two new tables, touches nothing existing.

-- CreateEnum does not exist in SQLite; statuses/scope vocabularies are enforced
-- server-side (strict transition tables in src/lib/ci/fleet/reviewers.ts).

CREATE TABLE "ExpertReviewerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "reviewerCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLICATION_PENDING',
    "approvedDomains" TEXT NOT NULL DEFAULT '[]',
    "approvedLanguages" TEXT NOT NULL DEFAULT '[]',
    "qualificationCategory" TEXT,
    "professionalExperience" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verificationNote" TEXT,
    "issuingBody" TEXT,
    "scopeNote" TEXT,
    "expiresAt" DATETIME,
    "conflictOfInterest" TEXT NOT NULL,
    "suspendedReason" TEXT,
    "revokedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ExpertReviewerProfile_studentId_key" ON "ExpertReviewerProfile"("studentId");
CREATE UNIQUE INDEX "ExpertReviewerProfile_reviewerCode_key" ON "ExpertReviewerProfile"("reviewerCode");
CREATE INDEX "ExpertReviewerProfile_status_idx" ON "ExpertReviewerProfile"("status");
CREATE INDEX "ExpertReviewerProfile_category_status_idx" ON "ExpertReviewerProfile"("category", "status");

CREATE TABLE "ExpertReviewerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "rationale" TEXT,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ExpertReviewerEvent_profileId_createdAt_idx" ON "ExpertReviewerEvent"("profileId", "createdAt");
CREATE INDEX "ExpertReviewerEvent_eventType_idx" ON "ExpertReviewerEvent"("eventType");
