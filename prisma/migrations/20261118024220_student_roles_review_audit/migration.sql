-- CreateTable
CREATE TABLE "PyqReviewEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "learningLevel" TEXT,
    "interestsJson" TEXT,
    "preferencesJson" TEXT,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "onboardedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Student" ("createdAt", "displayName", "email", "id", "interestsJson", "learningLevel", "passwordHash", "preferencesJson", "updatedAt") SELECT "createdAt", "displayName", "email", "id", "interestsJson", "learningLevel", "passwordHash", "preferencesJson", "updatedAt" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");
CREATE INDEX "Student_role_idx" ON "Student"("role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PyqReviewEvent_questionId_createdAt_idx" ON "PyqReviewEvent"("questionId", "createdAt");

-- CreateIndex
CREATE INDEX "PyqReviewEvent_reviewerId_createdAt_idx" ON "PyqReviewEvent"("reviewerId", "createdAt");
