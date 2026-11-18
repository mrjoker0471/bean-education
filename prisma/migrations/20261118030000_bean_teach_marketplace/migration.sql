-- CreateTable
CREATE TABLE "TeacherProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "teachingName" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "subjectsJson" TEXT NOT NULL,
    "levelsJson" TEXT NOT NULL,
    "languagesJson" TEXT NOT NULL,
    "qualificationsText" TEXT NOT NULL,
    "experienceYears" INTEGER NOT NULL,
    "portfolioUrl" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeacherProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeachAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ClassSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "targetLevel" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "timeZone" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "minimumStudents" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "plannedPricePaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassSession_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "bookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "attendanceMarkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassBooking_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassBooking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherProfile_studentId_key" ON "TeacherProfile"("studentId");

-- CreateIndex
CREATE INDEX "TeacherProfile_verificationStatus_idx" ON "TeacherProfile"("verificationStatus");

-- CreateIndex
CREATE INDEX "TeachAuditEvent_entityType_entityId_createdAt_idx" ON "TeachAuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "TeachAuditEvent_actorId_createdAt_idx" ON "TeachAuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ClassSession_status_startsAt_idx" ON "ClassSession"("status", "startsAt");

-- CreateIndex
CREATE INDEX "ClassSession_teacherProfileId_startsAt_idx" ON "ClassSession"("teacherProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "ClassBooking_classSessionId_status_idx" ON "ClassBooking"("classSessionId", "status");

-- CreateIndex
CREATE INDEX "ClassBooking_studentId_status_idx" ON "ClassBooking"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClassBooking_classSessionId_studentId_key" ON "ClassBooking"("classSessionId", "studentId");

