-- CreateTable
CREATE TABLE "ClassroomEvaluationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classSessionId" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "liveSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'PENDING',
    "trigger" TEXT NOT NULL,
    "requestedById" TEXT,
    "teacherNotes" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "claimedAt" DATETIME,
    "leaseUntil" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassroomEvaluationJob_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomEvaluationJob_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomAgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "modelId" TEXT,
    "inputDigest" TEXT,
    "outputJson" TEXT,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    CONSTRAINT "ClassroomAgentRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ClassroomEvaluationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomEvaluationReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CURRENT',
    "reportJson" TEXT NOT NULL,
    "insufficientEvidence" BOOLEAN NOT NULL DEFAULT false,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "modelId" TEXT,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomEvaluationReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ClassroomEvaluationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomEvidenceRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "summary" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomEvidenceRef_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ClassroomEvaluationReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomStudentSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL,
    "modelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomStudentSummary_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ClassroomEvaluationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomStudentSummary_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ClassBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomEvaluationDispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "findingsJson" TEXT NOT NULL,
    "assignedAdminId" TEXT,
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassroomEvaluationDispute_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ClassroomEvaluationReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassroomDisputeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disputeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomDisputeEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "ClassroomEvaluationDispute" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomEvaluationJob_classSessionId_key" ON "ClassroomEvaluationJob"("classSessionId");

-- CreateIndex
CREATE INDEX "ClassroomEvaluationJob_status_leaseUntil_idx" ON "ClassroomEvaluationJob"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "ClassroomEvaluationJob_teacherProfileId_status_idx" ON "ClassroomEvaluationJob"("teacherProfileId", "status");

-- CreateIndex
CREATE INDEX "ClassroomAgentRun_jobId_startedAt_idx" ON "ClassroomAgentRun"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "ClassroomEvaluationReport_teacherProfileId_createdAt_idx" ON "ClassroomEvaluationReport"("teacherProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "ClassroomEvaluationReport_status_idx" ON "ClassroomEvaluationReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomEvaluationReport_classSessionId_version_key" ON "ClassroomEvaluationReport"("classSessionId", "version");

-- CreateIndex
CREATE INDEX "ClassroomEvidenceRef_reportId_idx" ON "ClassroomEvidenceRef"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomStudentSummary_bookingId_key" ON "ClassroomStudentSummary"("bookingId");

-- CreateIndex
CREATE INDEX "ClassroomStudentSummary_classSessionId_idx" ON "ClassroomStudentSummary"("classSessionId");

-- CreateIndex
CREATE INDEX "ClassroomEvaluationDispute_reportId_status_idx" ON "ClassroomEvaluationDispute"("reportId", "status");

-- CreateIndex
CREATE INDEX "ClassroomEvaluationDispute_teacherId_status_idx" ON "ClassroomEvaluationDispute"("teacherId", "status");

-- CreateIndex
CREATE INDEX "ClassroomDisputeEvent_disputeId_createdAt_idx" ON "ClassroomDisputeEvent"("disputeId", "createdAt");
