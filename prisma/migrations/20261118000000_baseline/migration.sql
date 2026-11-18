-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "authority" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "state" TEXT,
    "description" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'CURRENT',
    "syllabusStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "contentNote" TEXT,
    "sourceRefs" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Exam_categorySlug_fkey" FOREIGN KEY ("categorySlug") REFERENCES "Category" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "paperNote" TEXT,
    "patternJson" TEXT,
    CONSTRAINT "Stage_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stageId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Subject_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Unit_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unitId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "canonicalSlug" TEXT,
    CONSTRAINT "Topic_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "canonicalSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "sourceRefs" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT,
    "topicId" TEXT,
    "canonicalSlug" TEXT,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'English',
    "accessType" TEXT NOT NULL DEFAULT 'FREE',
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "lastChecked" DATETIME,
    "attribution" TEXT,
    "note" TEXT,
    "fileKind" TEXT,
    "docDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Resource_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Resource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "stageId" TEXT,
    "subjectId" TEXT,
    "topicId" TEXT,
    "canonicalSlug" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "optionsJson" TEXT NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "language" TEXT NOT NULL DEFAULT 'English',
    "sourceType" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "sourcePaper" TEXT,
    "year" INTEGER,
    "verificationStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
    CONSTRAINT "Question_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Question_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "examId" TEXT,
    "stageId" TEXT,
    "subjectId" TEXT,
    "topicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TestTemplate_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestTemplate_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestTemplate_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestTemplate_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT,
    "userId" TEXT,
    "templateId" TEXT,
    "examId" TEXT,
    "examLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topicId" TEXT,
    "subjectId" TEXT,
    "configJson" TEXT NOT NULL,
    "questionIdsJson" TEXT NOT NULL,
    "answersJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "score" REAL,
    "maxScore" REAL,
    "correctCount" INTEGER,
    "wrongCount" INTEGER,
    "skippedCount" INTEGER,
    "timeSpentSec" INTEGER,
    "perTopicJson" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'BANK',
    "documentId" TEXT,
    "riisheTestId" TEXT,
    CONSTRAINT "Attempt_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TestTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Attempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Attempt_riisheTestId_fkey" FOREIGN KEY ("riisheTestId") REFERENCES "RiisheTest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "statusDetail" TEXT,
    "contentHash" TEXT NOT NULL,
    "extractionJson" TEXT,
    "analysisJson" TEXT,
    "examLabel" TEXT,
    "subjectLabel" TEXT,
    "topicLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RiisheTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "statusDetail" TEXT,
    "focusTopicsJson" TEXT,
    "weakFocus" BOOLEAN NOT NULL DEFAULT false,
    "requestedCount" INTEGER NOT NULL DEFAULT 50,
    "configJson" TEXT NOT NULL,
    "distributionJson" TEXT,
    "sourceDocIdsJson" TEXT,
    "statsJson" TEXT,
    "questionIdsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RiisheTest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudyDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiisheQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "optionsJson" TEXT NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'MEDIUM',
    "category" TEXT NOT NULL DEFAULT 'APPLICATION',
    "topic" TEXT,
    "pageRefsJson" TEXT,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VALIDATED',
    "validationNote" TEXT,
    CONSTRAINT "RiisheQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "RiisheTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiisheExplanation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RiisheChatTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guestId" TEXT NOT NULL,
    "documentId" TEXT,
    "attemptId" TEXT,
    "questionId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pagesCitedJson" TEXT,
    "grounding" TEXT,
    "sourcesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_slug_key" ON "Exam"("slug");

-- CreateIndex
CREATE INDEX "Exam_categorySlug_idx" ON "Exam"("categorySlug");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_examId_slug_key" ON "Stage"("examId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_stageId_slug_key" ON "Subject"("stageId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_subjectId_slug_key" ON "Unit"("subjectId", "slug");

-- CreateIndex
CREATE INDEX "Topic_canonicalSlug_idx" ON "Topic"("canonicalSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_unitId_slug_key" ON "Topic"("unitId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Note_topicId_key" ON "Note"("topicId");

-- CreateIndex
CREATE INDEX "Resource_canonicalSlug_idx" ON "Resource"("canonicalSlug");

-- CreateIndex
CREATE INDEX "Resource_topicId_idx" ON "Resource"("topicId");

-- CreateIndex
CREATE INDEX "Question_examId_idx" ON "Question"("examId");

-- CreateIndex
CREATE INDEX "Question_topicId_idx" ON "Question"("topicId");

-- CreateIndex
CREATE INDEX "Question_canonicalSlug_idx" ON "Question"("canonicalSlug");

-- CreateIndex
CREATE UNIQUE INDEX "TestTemplate_slug_key" ON "TestTemplate"("slug");

-- CreateIndex
CREATE INDEX "Attempt_guestId_idx" ON "Attempt"("guestId");

-- CreateIndex
CREATE INDEX "Attempt_status_idx" ON "Attempt"("status");

-- CreateIndex
CREATE INDEX "StudyDocument_guestId_idx" ON "StudyDocument"("guestId");

-- CreateIndex
CREATE INDEX "StudyDocument_contentHash_idx" ON "StudyDocument"("contentHash");

-- CreateIndex
CREATE INDEX "RiisheTest_guestId_idx" ON "RiisheTest"("guestId");

-- CreateIndex
CREATE INDEX "RiisheTest_documentId_idx" ON "RiisheTest"("documentId");

-- CreateIndex
CREATE INDEX "RiisheQuestion_testId_idx" ON "RiisheQuestion"("testId");

-- CreateIndex
CREATE INDEX "RiisheQuestion_documentId_idx" ON "RiisheQuestion"("documentId");

-- CreateIndex
CREATE INDEX "RiisheExplanation_attemptId_idx" ON "RiisheExplanation"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "RiisheExplanation_attemptId_questionId_key" ON "RiisheExplanation"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "RiisheChatTurn_guestId_createdAt_idx" ON "RiisheChatTurn"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "RiisheChatTurn_documentId_idx" ON "RiisheChatTurn"("documentId");

-- CreateIndex
CREATE INDEX "RiisheChatTurn_attemptId_questionId_idx" ON "RiisheChatTurn"("attemptId", "questionId");

