-- Phase 3F: Riishe Learning Studio continuity — persistence for interactive
-- learning activities (concept maps, step-by-step explanations, formula
-- walkthroughs, flashcards, mini-tests).
--
-- Additive, backward-compatible change: ONE new table. No existing table is
-- altered, no row is rewritten, no column changes type. Safe to replay on any
-- database that already ran the Phase 3D migration
-- (20261122000000_phase3d_chat_preferences).
--
-- Scope:
--   RiisheStudioActivity stores the server-validated activity snapshot plus
--   learner progress/responses so a student can resume an unfinished activity,
--   review completed ones, and keep a private history. Learner responses live
--   in dedicated JSON columns, separate from generated content.
--
-- Deliberate non-goals (documented in
-- docs/PHASE-3F-RIISHE-LEARNING-CONTINUITY.md):
--   - No FK to StudyDocument: history survives a deleted source document; the
--     display title is snapshotted on the row.
--   - No writes to Attempt / TopicMastery / RevisionScheduleItem /
--     MistakeRecord / LearningAction: studio self-study evidence never feeds
--     the exam mastery systems, so completion cannot inflate progress.
--
-- Rollback: the table is self-contained — `DROP TABLE "RiisheStudioActivity";`
-- removes it without touching any other object. No other rollback step is
-- needed because nothing else in the schema depends on it.

CREATE TABLE "RiisheStudioActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "studentId" TEXT,
    "kind" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "grounding" TEXT NOT NULL,
    "documentId" TEXT,
    "documentTitle" TEXT,
    "responseLanguage" TEXT,
    "activityVersion" INTEGER NOT NULL DEFAULT 1,
    "activityJson" TEXT NOT NULL,
    "progressJson" TEXT,
    "responsesJson" TEXT,
    "resultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

CREATE INDEX "RiisheStudioActivity_guestId_status_updatedAt_idx" ON "RiisheStudioActivity"("guestId", "status", "updatedAt");
CREATE INDEX "RiisheStudioActivity_studentId_status_idx" ON "RiisheStudioActivity"("studentId", "status");
CREATE INDEX "RiisheStudioActivity_guestId_kind_idx" ON "RiisheStudioActivity"("guestId", "kind");
CREATE INDEX "RiisheStudioActivity_documentId_idx" ON "RiisheStudioActivity"("documentId");
