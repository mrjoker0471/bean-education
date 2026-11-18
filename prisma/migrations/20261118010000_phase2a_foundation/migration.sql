-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN "studentId" TEXT;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN "importedBatchId" TEXT;
ALTER TABLE "Question" ADD COLUMN "pyqHash" TEXT;
ALTER TABLE "Question" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "Question" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "Question" ADD COLUMN "reviewedBy" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceRef" TEXT;

-- AlterTable
ALTER TABLE "RiisheChatTurn" ADD COLUMN "studentId" TEXT;

-- AlterTable
ALTER TABLE "RiisheTest" ADD COLUMN "studentId" TEXT;

-- AlterTable
ALTER TABLE "StudyDocument" ADD COLUMN "studentId" TEXT;

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "learningLevel" TEXT,
    "interestsJson" TEXT,
    "preferencesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "examId" TEXT,
    "topicId" TEXT,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudyGoal_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PyqImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperTitle" TEXT NOT NULL,
    "examSlug" TEXT,
    "examLabel" TEXT,
    "stageLabel" TEXT,
    "subjectLabel" TEXT,
    "year" INTEGER,
    "session" TEXT,
    "sourceCitation" TEXT,
    "fileName" TEXT NOT NULL,
    "importedBy" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RiisheJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "error" TEXT,
    "claimedAt" DATETIME,
    "leaseUntil" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_studentId_idx" ON "Session"("studentId");

-- CreateIndex
CREATE INDEX "StudyGoal_studentId_status_idx" ON "StudyGoal"("studentId", "status");

-- CreateIndex
CREATE INDEX "RiisheJob_status_leaseUntil_idx" ON "RiisheJob"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "RiisheJob_ownerId_status_idx" ON "RiisheJob"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiisheJob_kind_refId_key" ON "RiisheJob"("kind", "refId");

-- CreateIndex
CREATE INDEX "JobQuota_windowStart_idx" ON "JobQuota"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "JobQuota_ownerKey_kind_windowKey_key" ON "JobQuota"("ownerKey", "kind", "windowKey");

-- CreateIndex
CREATE INDEX "Attempt_studentId_idx" ON "Attempt"("studentId");

-- CreateIndex
CREATE INDEX "Question_pyqHash_idx" ON "Question"("pyqHash");

-- CreateIndex
CREATE INDEX "Question_sourceType_year_idx" ON "Question"("sourceType", "year");

-- CreateIndex
CREATE INDEX "Question_importedBatchId_idx" ON "Question"("importedBatchId");

-- CreateIndex
CREATE INDEX "RiisheChatTurn_studentId_createdAt_idx" ON "RiisheChatTurn"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "RiisheTest_studentId_idx" ON "RiisheTest"("studentId");

-- CreateIndex
CREATE INDEX "StudyDocument_studentId_idx" ON "StudyDocument"("studentId");

