-- BEAN Classroom Intelligence (CI-4C): append-only domain-pack review ledger.
-- One row per recorded human curator decision; reviewer identity is resolved
-- server-side from the ADMIN session; packChecksum binds decisions to the
-- exact inspected pack content; no FK on reviewer id (governance history
-- survives account deletion).

-- CreateTable
CREATE TABLE "ClassroomPackReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "packChecksum" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewerStudentId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ClassroomPackReview_packId_packVersion_idx" ON "ClassroomPackReview"("packId", "packVersion");

-- CreateIndex
CREATE INDEX "ClassroomPackReview_reviewerStudentId_idx" ON "ClassroomPackReview"("reviewerStudentId");
