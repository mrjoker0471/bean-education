-- BEAN Classroom Intelligence (CI-4D): source-grounded knowledge chunk store.
-- Idempotent ingestion via chunkKey (sha256 of source|locator|content); full
-- provenance on every row (locator, source version, obligations recorded
-- verbatim from the CI-4A licence gate); revocation marks withdrawal without
-- deleting the audit trail.

-- CreateTable
CREATE TABLE "ClassroomKnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chunkKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "packDomainId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "sourceVersion" TEXT NOT NULL,
    "citesSourceIds" TEXT NOT NULL DEFAULT '[]',
    "obligationsJson" TEXT NOT NULL DEFAULT '[]',
    "injectionScan" TEXT NOT NULL DEFAULT 'PASS',
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedReason" TEXT,
    "ingestedBy" TEXT NOT NULL,
    "ingestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomKnowledgeChunk_chunkKey_key" ON "ClassroomKnowledgeChunk"("chunkKey");

-- CreateIndex
CREATE INDEX "ClassroomKnowledgeChunk_packDomainId_revoked_idx" ON "ClassroomKnowledgeChunk"("packDomainId", "revoked");

-- CreateIndex
CREATE INDEX "ClassroomKnowledgeChunk_sourceId_revoked_idx" ON "ClassroomKnowledgeChunk"("sourceId", "revoked");

-- CreateIndex
CREATE INDEX "ClassroomKnowledgeChunk_language_idx" ON "ClassroomKnowledgeChunk"("language");
