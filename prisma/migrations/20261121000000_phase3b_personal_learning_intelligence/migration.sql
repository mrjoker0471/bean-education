-- CreateTable
CREATE TABLE "TopicMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "topicId" TEXT NOT NULL,
    "topicName" TEXT NOT NULL,
    "examLabel" TEXT,
    "status" TEXT NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "evidenceQuestions" INTEGER NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "correctDistinct" INTEGER NOT NULL,
    "statusReason" TEXT,
    "lastActivityAt" DATETIME,
    "computedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StudyPlanTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "planDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topicId" TEXT,
    "topicName" TEXT,
    "examLabel" TEXT,
    "estimatedMinutes" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RevisionScheduleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "topicId" TEXT NOT NULL,
    "topicName" TEXT NOT NULL,
    "examLabel" TEXT,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastOutcome" TEXT,
    "lastReviewedAt" DATETIME,
    "nextDueAt" DATETIME NOT NULL,
    "misconceptionFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MistakeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "topicId" TEXT,
    "topicName" TEXT,
    "chosenIndex" INTEGER NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "categoryReason" TEXT,
    "studentTag" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LearningAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "actionKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "topicId" TEXT,
    "href" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "snoozedUntil" DATETIME,
    "resolvedAt" DATETIME,
    "outcomeJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TopicMastery_guestId_status_idx" ON "TopicMastery"("guestId", "status");

-- CreateIndex
CREATE INDEX "TopicMastery_studentId_status_idx" ON "TopicMastery"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TopicMastery_guestId_topicId_key" ON "TopicMastery"("guestId", "topicId");

-- CreateIndex
CREATE INDEX "StudyPlanTask_guestId_planDate_status_idx" ON "StudyPlanTask"("guestId", "planDate", "status");

-- CreateIndex
CREATE INDEX "StudyPlanTask_studentId_planDate_idx" ON "StudyPlanTask"("studentId", "planDate");

-- CreateIndex
CREATE INDEX "RevisionScheduleItem_guestId_nextDueAt_idx" ON "RevisionScheduleItem"("guestId", "nextDueAt");

-- CreateIndex
CREATE INDEX "RevisionScheduleItem_studentId_nextDueAt_idx" ON "RevisionScheduleItem"("studentId", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionScheduleItem_guestId_topicId_key" ON "RevisionScheduleItem"("guestId", "topicId");

-- CreateIndex
CREATE INDEX "MistakeRecord_guestId_createdAt_idx" ON "MistakeRecord"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "MistakeRecord_guestId_topicId_idx" ON "MistakeRecord"("guestId", "topicId");

-- CreateIndex
CREATE INDEX "MistakeRecord_studentId_createdAt_idx" ON "MistakeRecord"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "MistakeRecord_questionId_idx" ON "MistakeRecord"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "MistakeRecord_attemptId_questionId_key" ON "MistakeRecord"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "LearningAction_guestId_status_idx" ON "LearningAction"("guestId", "status");

-- CreateIndex
CREATE INDEX "LearningAction_studentId_status_idx" ON "LearningAction"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningAction_guestId_actionKey_key" ON "LearningAction"("guestId", "actionKey");

