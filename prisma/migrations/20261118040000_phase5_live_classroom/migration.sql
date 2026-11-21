-- ─── Phase 5: BEAN Live Classroom (additive) ─────────────────────────────────
-- New tables only: no existing column is altered and no row is touched.
-- LiveClassSession.liveClassSessionId → ClassSession (CASCADE on class delete)
-- LiveClassParticipant.studentId      → Student (CASCADE on account delete)

-- LiveClassSession: one primary live room per scheduled ClassSession.
CREATE TABLE "LiveClassSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classSessionId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "startedById" TEXT NOT NULL,
    "endedById" TEXT,
    "reservedParticipantMinutes" INTEGER NOT NULL DEFAULT 0,
    "actualParticipantMinutes" INTEGER,
    "usageFinalisedAt" DATETIME,
    "usageMonthKey" TEXT NOT NULL,
    "endReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveClassSession_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- LiveClassParticipant: per-person verified attendance evidence (webhook-only).
CREATE TABLE "LiveClassParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveClassSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "participantIdentity" TEXT NOT NULL,
    "participantRole" TEXT NOT NULL,
    "firstJoinedAt" DATETIME,
    "activeSince" DATETIME,
    "lastLeftAt" DATETIME,
    "totalConnectedSeconds" INTEGER NOT NULL DEFAULT 0,
    "reconnectCount" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveClassParticipant_liveClassSessionId_fkey" FOREIGN KEY ("liveClassSessionId") REFERENCES "LiveClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LiveClassParticipant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- LiveKitWebhookEvent: provider event idempotency ledger.
CREATE TABLE "LiveKitWebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerEventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "processingStatus" TEXT NOT NULL DEFAULT 'PROCESSED',
    "errorCode" TEXT
);

-- LiveUsageMonth: monthly participant-minute budget accounting.
CREATE TABLE "LiveUsageMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL,
    "budgetParticipantMinutes" INTEGER NOT NULL,
    "reservedParticipantMinutes" INTEGER NOT NULL DEFAULT 0,
    "usedParticipantMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- LiveWhiteboardState: teacher-authored snapshot for late joiners.
CREATE TABLE "LiveWhiteboardState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveClassSessionId" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveWhiteboardState_liveClassSessionId_fkey" FOREIGN KEY ("liveClassSessionId") REFERENCES "LiveClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique + lookup indexes
CREATE UNIQUE INDEX "LiveClassSession_classSessionId_key" ON "LiveClassSession"("classSessionId");
CREATE UNIQUE INDEX "LiveClassSession_roomName_key" ON "LiveClassSession"("roomName");
CREATE INDEX "LiveClassSession_status_idx" ON "LiveClassSession"("status");
CREATE INDEX "LiveClassSession_usageMonthKey_idx" ON "LiveClassSession"("usageMonthKey");
CREATE UNIQUE INDEX "LiveClassParticipant_liveClassSessionId_participantIdentity_key" ON "LiveClassParticipant"("liveClassSessionId", "participantIdentity");
CREATE INDEX "LiveClassParticipant_liveClassSessionId_idx" ON "LiveClassParticipant"("liveClassSessionId");
CREATE INDEX "LiveClassParticipant_studentId_idx" ON "LiveClassParticipant"("studentId");
CREATE UNIQUE INDEX "LiveKitWebhookEvent_providerEventId_key" ON "LiveKitWebhookEvent"("providerEventId");
CREATE INDEX "LiveKitWebhookEvent_roomName_receivedAt_idx" ON "LiveKitWebhookEvent"("roomName", "receivedAt");
CREATE UNIQUE INDEX "LiveUsageMonth_monthKey_key" ON "LiveUsageMonth"("monthKey");
CREATE UNIQUE INDEX "LiveWhiteboardState_liveClassSessionId_key" ON "LiveWhiteboardState"("liveClassSessionId");
