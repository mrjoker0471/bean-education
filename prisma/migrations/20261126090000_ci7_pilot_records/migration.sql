-- CI-7E/G: additive pilot records — disagreement analysis (append-only) and
-- pilot activation events (append-only). No existing table is altered; no
-- column is dropped or rewritten; review history is untouched.

-- BEGIN MIGRATION CI7-1 disagreement analysis --
CREATE TABLE IF NOT EXISTS "Ci7DisagreementAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "packChecksum" TEXT NOT NULL,
    "reviewIdsJson" TEXT NOT NULL,
    "decisionsJson" TEXT NOT NULL,
    "rubricDimensionsJson" TEXT NOT NULL,
    "evidenceCitedJson" TEXT NOT NULL,
    -- FACTUAL | INTERPRETIVE | RUBRIC_RELATED | MIXED
    "classification" TEXT NOT NULL,
    -- Optional reference to the adjudication outcome (assignment/adjudicator id).
    "adjudicationRef" TEXT,
    -- Adjudication outcome text when authorised; null while unresolved.
    "adjudicationOutcome" TEXT,
    "correctionRequired" BOOLEAN NOT NULL DEFAULT false,
    "correctionApplied" BOOLEAN NOT NULL DEFAULT false,
    "packVersionChanged" BOOLEAN NOT NULL DEFAULT false,
    "reReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "analysis" TEXT NOT NULL,
    -- FK-less audit: the analysis survives account deletion, like the CI-5 ledgers.
    "recordedByAdminId" TEXT NOT NULL,
    "recordedByAdminName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Ci7DisagreementAnalysis_packId_idx" ON "Ci7DisagreementAnalysis"("packId");
CREATE INDEX "Ci7DisagreementAnalysis_packChecksum_idx" ON "Ci7DisagreementAnalysis"("packChecksum");
-- END MIGRATION CI7-1 --

-- BEGIN MIGRATION CI7-2 pilot activation events --
CREATE TABLE IF NOT EXISTS "Ci7PilotActivation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    -- ACTIVATED | DEACTIVATED (kill switch / rollback) | REACTIVATED | ROLLED_BACK
    "eventType" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "packChecksum" TEXT NOT NULL,
    "pilotScope" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    -- FK-less audit: activation history survives account deletion.
    "actorAdminId" TEXT NOT NULL,
    "actorAdminName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Ci7PilotActivation_packId_idx" ON "Ci7PilotActivation"("packId");
-- END MIGRATION CI7-2 --
