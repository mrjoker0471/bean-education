-- BEAN Classroom Intelligence (CI-3C): durable per-agent fleet task queue.
-- One row per planned agent per class; taskKey is UNIQUE (idempotent dispatch);
-- CAS claims + lease recovery; honest skipReason; charter §12 terminal states.

-- CreateTable
CREATE TABLE "ClassroomFleetTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskKey" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskRole" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "skipReason" TEXT,
    "contractVersion" TEXT NOT NULL,
    "outputJson" TEXT,
    "error" TEXT,
    "claimedAt" DATETIME,
    "leaseUntil" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassroomFleetTask_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomFleetTask_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomFleetTask_taskKey_key" ON "ClassroomFleetTask"("taskKey");

-- CreateIndex
CREATE INDEX "ClassroomFleetTask_status_leaseUntil_idx" ON "ClassroomFleetTask"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "ClassroomFleetTask_classSessionId_status_idx" ON "ClassroomFleetTask"("classSessionId", "status");

-- CreateIndex
CREATE INDEX "ClassroomFleetTask_teacherProfileId_status_idx" ON "ClassroomFleetTask"("teacherProfileId", "status");

-- CreateIndex
CREATE INDEX "ClassroomFleetTask_taskRole_priority_idx" ON "ClassroomFleetTask"("taskRole", "priority");
