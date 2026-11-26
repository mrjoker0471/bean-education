-- BEAN Classroom Intelligence (CI-6F): reviewer availability / workload control.
-- Additive only — one new column on ExpertReviewerProfile. A reviewer who has
-- PAUSED availability receives no new assignments until they resume
-- (server-side gate in createAssignment; in-flight work is unaffected).

ALTER TABLE "ExpertReviewerProfile" ADD COLUMN "availability" TEXT NOT NULL DEFAULT 'AVAILABLE';
