-- BEAN Classroom Intelligence (CI-3D): the consent-gated, visible live
-- classroom observer. One row per live session (unique FK = DB guarantee of
-- exactly one visible observer per room). Structured-only mode: no media
-- subscription, no transcription — honest provenance columns stay false.

-- CreateTable
CREATE TABLE "ClassroomObserverSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liveClassSessionId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "observerIdentity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "leftReason" TEXT,
    "consentMode" TEXT NOT NULL DEFAULT 'STRUCTURED_ONLY',
    "transcriptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "canPublishMedia" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "reconnectCount" INTEGER NOT NULL DEFAULT 0,
    "connectedSeconds" INTEGER NOT NULL DEFAULT 0,
    "evidenceJson" TEXT,
    "eligibilityJson" TEXT,
    "error" TEXT,
    "dispatchedBy" TEXT NOT NULL,
    "lastHeartbeatAt" DATETIME,
    "connectedAt" DATETIME,
    "leftAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassroomObserverSession_liveClassSessionId_fkey" FOREIGN KEY ("liveClassSessionId") REFERENCES "LiveClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomObserverSession_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomObserverSession_liveClassSessionId_key" ON "ClassroomObserverSession"("liveClassSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassroomObserverSession_observerIdentity_key" ON "ClassroomObserverSession"("observerIdentity");

-- CreateIndex
CREATE INDEX "ClassroomObserverSession_status_lastHeartbeatAt_idx" ON "ClassroomObserverSession"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "ClassroomObserverSession_classSessionId_status_idx" ON "ClassroomObserverSession"("classSessionId", "status");
