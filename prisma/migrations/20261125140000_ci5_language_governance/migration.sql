-- BEAN Classroom Intelligence (CI-5E): durable language governance.
-- Additive only — three new tables; nothing existing is touched.

CREATE TABLE "LanguageBenchmarkMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "languageTag" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "dialect" TEXT NOT NULL DEFAULT '',
    "modelProvider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "benchmarkVersion" TEXT NOT NULL,
    "benchmarkChecksum" TEXT NOT NULL,
    "testRef" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "caseCount" INTEGER NOT NULL,
    "passedCount" INTEGER NOT NULL,
    "measuredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "LanguageBenchmarkMeasurement_languageTag_task_domain_dialect_modelProvider_modelVersion_benchmarkVersion_benchmarkChecksum_key" ON "LanguageBenchmarkMeasurement"("languageTag", "task", "domain", "dialect", "modelProvider", "modelVersion", "benchmarkVersion", "benchmarkChecksum");
CREATE INDEX "LanguageBenchmarkMeasurement_languageTag_task_idx" ON "LanguageBenchmarkMeasurement"("languageTag", "task");
CREATE INDEX "LanguageBenchmarkMeasurement_benchmarkVersion_idx" ON "LanguageBenchmarkMeasurement"("benchmarkVersion");

CREATE TABLE "LanguageCapabilityReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "measurementId" TEXT NOT NULL,
    "languageTag" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "dialect" TEXT NOT NULL DEFAULT '',
    "modelProvider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "benchmarkVersion" TEXT NOT NULL,
    "benchmarkChecksum" TEXT NOT NULL,
    "reviewerStudentId" TEXT NOT NULL,
    "reviewerCode" TEXT NOT NULL,
    "reviewerQualification" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "LanguageCapabilityReview_languageTag_task_idx" ON "LanguageCapabilityReview"("languageTag", "task");
CREATE INDEX "LanguageCapabilityReview_measurementId_idx" ON "LanguageCapabilityReview"("measurementId");
CREATE INDEX "LanguageCapabilityReview_reviewerStudentId_idx" ON "LanguageCapabilityReview"("reviewerStudentId");

CREATE TABLE "LanguageCapabilityStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "languageTag" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "dialect" TEXT NOT NULL DEFAULT '',
    "modelProvider" TEXT,
    "modelVersion" TEXT,
    "benchmarkVersion" TEXT,
    "status" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "latestMeasurementId" TEXT,
    "approvalCount" INTEGER NOT NULL DEFAULT 0,
    "contributingReviewIds" TEXT NOT NULL DEFAULT '[]',
    "supersededBy" TEXT,
    "note" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "LanguageCapabilityStatus_languageTag_task_domain_dialect_modelProvider_modelVersion_benchmarkVersion_key" ON "LanguageCapabilityStatus"("languageTag", "task", "domain", "dialect", "modelProvider", "modelVersion", "benchmarkVersion");
CREATE INDEX "LanguageCapabilityStatus_languageTag_task_status_idx" ON "LanguageCapabilityStatus"("languageTag", "task", "status");
