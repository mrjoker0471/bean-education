-- BEAN Classroom Intelligence (CI-5G): classroom-report audit pilot.
-- Additive only — one new table; nothing existing is touched.

CREATE TABLE "ClassroomReportAuditReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "reportVersion" INTEGER NOT NULL,
    "reportChecksum" TEXT NOT NULL,
    "reviewerStudentId" TEXT NOT NULL,
    "reviewerCode" TEXT NOT NULL,
    "assignmentId" TEXT,
    "verdict" TEXT NOT NULL,
    "supportedFindings" TEXT NOT NULL DEFAULT '[]',
    "unsupportedFindings" TEXT NOT NULL DEFAULT '[]',
    "ambiguousFindings" TEXT NOT NULL DEFAULT '[]',
    "unobservableMarkers" TEXT NOT NULL DEFAULT '[]',
    "evidenceAuditorFindingsPreserved" BOOLEAN NOT NULL DEFAULT true,
    "rationale" TEXT NOT NULL,
    "maskingNote" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ClassroomReportAuditReview_reportId_reportVersion_idx" ON "ClassroomReportAuditReview"("reportId", "reportVersion");
CREATE INDEX "ClassroomReportAuditReview_reviewerStudentId_idx" ON "ClassroomReportAuditReview"("reviewerStudentId");
