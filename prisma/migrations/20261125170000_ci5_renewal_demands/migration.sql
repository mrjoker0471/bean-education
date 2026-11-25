-- BEAN Classroom Intelligence (CI-5H): re-review lifecycle demands.
-- Additive only — one new table; nothing existing is touched.

CREATE TABLE "ExpertReviewRenewalDemand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "demandedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "ExpertReviewRenewalDemand_subjectType_subjectKey_status_idx" ON "ExpertReviewRenewalDemand"("subjectType", "subjectKey", "status");
CREATE INDEX "ExpertReviewRenewalDemand_trigger_status_idx" ON "ExpertReviewRenewalDemand"("trigger", "status");
