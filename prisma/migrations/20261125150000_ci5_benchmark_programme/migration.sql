-- BEAN Classroom Intelligence (CI-5F): expert-labelled benchmark programme.
-- Additive only — three new tables; nothing existing is touched.

CREATE TABLE "ExpertBenchmarkDataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskKind" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "languageTag" TEXT NOT NULL DEFAULT '',
    "casesJson" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ExpertBenchmarkDataset_slug_version_key" ON "ExpertBenchmarkDataset"("slug", "version");
CREATE INDEX "ExpertBenchmarkDataset_taskKind_split_idx" ON "ExpertBenchmarkDataset"("taskKind", "split");

CREATE TABLE "ExpertBenchmarkCaseLabel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "reviewerProfileId" TEXT NOT NULL,
    "reviewerCode" TEXT NOT NULL,
    "expectedResults" TEXT NOT NULL,
    "prohibitedConclusions" TEXT NOT NULL DEFAULT '[]',
    "supportingSources" TEXT NOT NULL DEFAULT '[]',
    "confidence" TEXT NOT NULL,
    "ambiguityNote" TEXT,
    "rubricVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ExpertBenchmarkCaseLabel_datasetId_datasetVersion_caseKey_reviewerProfileId_key" ON "ExpertBenchmarkCaseLabel"("datasetId", "datasetVersion", "caseKey", "reviewerProfileId");
CREATE INDEX "ExpertBenchmarkCaseLabel_datasetId_caseKey_idx" ON "ExpertBenchmarkCaseLabel"("datasetId", "caseKey");

CREATE TABLE "ExpertBenchmarkRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "datasetChecksum" TEXT NOT NULL,
    "agentKind" TEXT NOT NULL,
    "agentDomain" TEXT NOT NULL DEFAULT '',
    "modelProvider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "ran" BOOLEAN NOT NULL,
    "runReason" TEXT NOT NULL,
    "expertLabelCount" INTEGER NOT NULL DEFAULT 0,
    "runBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ExpertBenchmarkRun_datasetId_agentKind_idx" ON "ExpertBenchmarkRun"("datasetId", "agentKind");
CREATE INDEX "ExpertBenchmarkRun_agentKind_createdAt_idx" ON "ExpertBenchmarkRun"("agentKind", "createdAt");
