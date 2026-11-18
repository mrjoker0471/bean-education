-- ─── Phase 6: BEAN Trust & Quality (additive) ────────────────────────────────
-- New tables only: no existing column is altered, no index on an existing
-- table changes, and no row is touched. FK columns live exclusively on the
-- new tables. Student.role semantics are untouched.

-- ClassReview: one verified review per ATTENDED booking (bookingId unique).
CREATE TABLE "ClassReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "reviewText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "showDisplayName" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" DATETIME,
    "publishedAt" DATETIME,
    "moderatedAt" DATETIME,
    "moderationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassReview_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ClassBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassReview_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassReview_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassReview_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- TeacherReviewResponse: one public teacher reply per review (reviewId unique).
CREATE TABLE "TeacherReviewResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewId" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "editedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeacherReviewResponse_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ClassReview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeacherReviewResponse_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- TeachComplaint: private support/investigation record (never public).
CREATE TABLE "TeachComplaint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complainantId" TEXT NOT NULL,
    "classSessionId" TEXT,
    "classBookingId" TEXT,
    "teacherProfileId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'NORMAL',
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeachComplaint_complainantId_fkey" FOREIGN KEY ("complainantId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeachComplaint_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- ComplaintEvent: append-only complaint history (idempotent transitions).
CREATE TABLE "ComplaintEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplaintEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "TeachComplaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- TrustAction: documented, auditable, enforceable teacher trust records.
CREATE TABLE "TrustAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherProfileId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT NOT NULL,
    "endedAt" DATETIME,
    "endedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustAction_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- TeachAppeal: appeal against complaint decisions, review moderation or trust
-- actions. originalDecisionById enables the server-side self-review ban.
CREATE TABLE "TeachAppeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appellantId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "originalDecisionById" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "assignedReviewerId" TEXT,
    "decision" TEXT,
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeachAppeal_appellantId_fkey" FOREIGN KEY ("appellantId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AppealEvent: append-only appeal history.
CREATE TABLE "AppealEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appealId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppealEvent_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "TeachAppeal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique indexes (uniqueness guarantees beyond server validation).
CREATE UNIQUE INDEX "ClassReview_bookingId_key" ON "ClassReview" ("bookingId");
CREATE UNIQUE INDEX "TeacherReviewResponse_reviewId_key" ON "TeacherReviewResponse" ("reviewId");

-- Lookup indexes.
CREATE INDEX "ClassReview_classSessionId_status_idx" ON "ClassReview" ("classSessionId", "status");
CREATE INDEX "ClassReview_teacherProfileId_status_idx" ON "ClassReview" ("teacherProfileId", "status");
CREATE INDEX "ClassReview_studentId_createdAt_idx" ON "ClassReview" ("studentId", "createdAt");
CREATE INDEX "TeacherReviewResponse_teacherProfileId_idx" ON "TeacherReviewResponse" ("teacherProfileId");
CREATE INDEX "TeachComplaint_status_severity_idx" ON "TeachComplaint" ("status", "severity");
CREATE INDEX "TeachComplaint_complainantId_createdAt_idx" ON "TeachComplaint" ("complainantId", "createdAt");
CREATE INDEX "TeachComplaint_assignedAdminId_status_idx" ON "TeachComplaint" ("assignedAdminId", "status");
CREATE INDEX "TeachComplaint_teacherProfileId_idx" ON "TeachComplaint" ("teacherProfileId");
CREATE INDEX "ComplaintEvent_complaintId_createdAt_idx" ON "ComplaintEvent" ("complaintId", "createdAt");
CREATE INDEX "TrustAction_teacherProfileId_isActive_idx" ON "TrustAction" ("teacherProfileId", "isActive");
CREATE INDEX "TeachAppeal_appellantId_status_idx" ON "TeachAppeal" ("appellantId", "status");
CREATE INDEX "TeachAppeal_targetType_targetId_idx" ON "TeachAppeal" ("targetType", "targetId");
CREATE INDEX "AppealEvent_appealId_createdAt_idx" ON "AppealEvent" ("appealId", "createdAt");
