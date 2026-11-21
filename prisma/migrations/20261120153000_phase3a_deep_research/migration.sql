-- AlterTable
ALTER TABLE "Question" ADD COLUMN "answerKeyRef" TEXT;
ALTER TABLE "Question" ADD COLUMN "questionNumber" TEXT;
ALTER TABLE "Question" ADD COLUMN "retrievedAt" DATETIME;
ALTER TABLE "Question" ADD COLUMN "sessionLabel" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourcePublisher" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "RiisheChatTurn" ADD COLUMN "researchSessionId" TEXT;

-- CreateTable
CREATE TABLE "ResearchSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "statusDetail" TEXT,
    "inputJson" TEXT NOT NULL,
    "progressJson" TEXT,
    "findingsJson" TEXT,
    "summaryJson" TEXT,
    "followUpsJson" TEXT,
    "documentIdsJson" TEXT,
    "searchesUsed" INTEGER NOT NULL DEFAULT 0,
    "fetchesUsed" INTEGER NOT NULL DEFAULT 0,
    "llmCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "host" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'web',
    "documentId" TEXT,
    "sourceClass" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "classReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "reachable" BOOLEAN,
    "httpStatus" INTEGER,
    "contentKind" TEXT,
    "publishedDate" TEXT,
    "retrievedAt" DATETIME,
    "snippet" TEXT,
    "evidenceJson" TEXT,
    "conflictFlag" BOOLEAN NOT NULL DEFAULT false,
    "rightsNote" TEXT,
    "notesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchSource_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchPyqCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "examSlug" TEXT,
    "examLabel" TEXT,
    "stageLabel" TEXT,
    "subjectLabel" TEXT,
    "topicLabel" TEXT,
    "year" INTEGER,
    "sessionLabel" TEXT,
    "questionNumber" TEXT,
    "paperTitle" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceTitle" TEXT,
    "sourcePublisher" TEXT,
    "sourceClass" TEXT,
    "retrievedAt" DATETIME,
    "publishedDate" TEXT,
    "locator" TEXT,
    "answerKeyUrl" TEXT,
    "answerKeyRef" TEXT,
    "proposedCorrectIndex" INTEGER,
    "optionsJson" TEXT,
    "verbatimText" TEXT,
    "evidenceJson" TEXT NOT NULL,
    "rightsStatus" TEXT NOT NULL DEFAULT 'REFERENCE_ONLY',
    "rightsNote" TEXT,
    "pyqHash" TEXT,
    "promotedQuestionId" TEXT,
    "promotedAt" DATETIME,
    "verificationNote" TEXT,
    "conflictNote" TEXT,
    "provenanceJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ResearchSession_guestId_createdAt_idx" ON "ResearchSession"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSession_studentId_createdAt_idx" ON "ResearchSession"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSession_guestId_status_idx" ON "ResearchSession"("guestId", "status");

-- CreateIndex
CREATE INDEX "ResearchSource_sessionId_idx" ON "ResearchSource"("sessionId");

-- CreateIndex
CREATE INDEX "ResearchSource_sessionId_status_idx" ON "ResearchSource"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ResearchPyqCandidate_guestId_status_idx" ON "ResearchPyqCandidate"("guestId", "status");

-- CreateIndex
CREATE INDEX "ResearchPyqCandidate_studentId_status_idx" ON "ResearchPyqCandidate"("studentId", "status");

-- CreateIndex
CREATE INDEX "ResearchPyqCandidate_status_idx" ON "ResearchPyqCandidate"("status");

-- CreateIndex
CREATE INDEX "ResearchPyqCandidate_sessionId_idx" ON "ResearchPyqCandidate"("sessionId");

-- CreateIndex
CREATE INDEX "ResearchPyqCandidate_promotedQuestionId_idx" ON "ResearchPyqCandidate"("promotedQuestionId");

-- CreateIndex
CREATE INDEX "RiisheChatTurn_researchSessionId_createdAt_idx" ON "RiisheChatTurn"("researchSessionId", "createdAt");

