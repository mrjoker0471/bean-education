-- BEAN Classroom Intelligence (CI-6E): expert recruitment invitations.
-- Additive only — one new table. Raw tokens are NEVER stored (sha256 hash
-- only); claiming starts or links an application and grants NO privileges.

CREATE TABLE "ExpertInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requestedDomainsJson" TEXT NOT NULL DEFAULT '[]',
    "requestedLanguagesJson" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdByAdminId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "claimedByStudentId" TEXT,
    "claimedAt" DATETIME,
    "revokedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ExpertInvitation_tokenHash_key" ON "ExpertInvitation"("tokenHash");
CREATE INDEX "ExpertInvitation_status_expiresAt_idx" ON "ExpertInvitation"("status", "expiresAt");
CREATE INDEX "ExpertInvitation_createdByAdminId_createdAt_idx" ON "ExpertInvitation"("createdByAdminId", "createdAt");
