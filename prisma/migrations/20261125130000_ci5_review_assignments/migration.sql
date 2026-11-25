-- BEAN Classroom Intelligence (CI-5C): expert review assignment & case management.
-- Additive only — two new tables, nothing existing is touched.

CREATE TABLE "ExpertReviewAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectVersion" TEXT,
    "subjectChecksum" TEXT,
    "riskClass" TEXT,
    "reviewerProfileId" TEXT NOT NULL,
    "reviewerCode" TEXT NOT NULL,
    "assignedByAdminId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "dueAt" DATETIME,
    "expiresAt" DATETIME,
    "coiCheckResult" TEXT NOT NULL DEFAULT 'PASS',
    "conflictNote" TEXT,
    "outcomeRef" TEXT,
    "reassignmentReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "ExpertReviewAssignment_subjectType_subjectKey_status_idx" ON "ExpertReviewAssignment"("subjectType", "subjectKey", "status");
CREATE INDEX "ExpertReviewAssignment_reviewerProfileId_status_idx" ON "ExpertReviewAssignment"("reviewerProfileId", "status");
CREATE INDEX "ExpertReviewAssignment_status_expiresAt_idx" ON "ExpertReviewAssignment"("status", "expiresAt");

CREATE TABLE "ExpertReviewAssignmentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "rationale" TEXT,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ExpertReviewAssignmentEvent_assignmentId_createdAt_idx" ON "ExpertReviewAssignmentEvent"("assignmentId", "createdAt");
CREATE INDEX "ExpertReviewAssignmentEvent_eventType_idx" ON "ExpertReviewAssignmentEvent"("eventType");
