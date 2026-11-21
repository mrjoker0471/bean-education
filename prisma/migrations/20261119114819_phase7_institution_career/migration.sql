-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "orgType" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "publicContact" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "slug" TEXT NOT NULL,
    "logoText" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "verificationNote" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LEARNER',
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "invitedByMembershipId" TEXT,
    "activatedAt" DATETIME,
    "suspendedAt" DATETIME,
    "leftAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationMembership_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT,
    "intendedRole" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" DATETIME,
    "acceptedByStudentId" TEXT,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYear" TEXT,
    "programmeLabel" TEXT,
    "batchLabel" TEXT,
    "sectionLabel" TEXT,
    "trackLabel" TEXT,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "capacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationGroupMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "enrollmentState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    CONSTRAINT "OrganizationGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationGroupMembership_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationAnnouncement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT,
    "authorMembershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationAnnouncement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationAnnouncement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT,
    "authorMembershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationResource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationResource_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdByMembershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "subjectLabel" TEXT,
    "submissionType" TEXT NOT NULL DEFAULT 'TEXT_AND_LINK',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" DATETIME,
    "dueAt" DATETIME,
    "maxScore" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "responseText" TEXT,
    "externalLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" DATETIME,
    "gradedByMembershipId" TEXT,
    "gradeValue" TEXT,
    "teacherFeedback" TEXT,
    "gradedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "OrganizationAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "preferredRoleTypes" TEXT,
    "preferredSkills" TEXT,
    "preferredLocations" TEXT,
    "workModes" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "publicSlug" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudentCareerSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "proficiency" TEXT,
    "description" TEXT,
    "verificationLabel" TEXT NOT NULL DEFAULT 'SELF_DECLARED',
    "sourceRef" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentCareerSkill_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "skillsUsed" TEXT,
    "projectUrl" TEXT,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerProject_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "issuerOrganizationId" TEXT NOT NULL,
    "credentialName" TEXT NOT NULL,
    "credentialDescription" TEXT,
    "issuedDate" DATETIME NOT NULL,
    "expiryDate" DATETIME,
    "credentialReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedByMembershipId" TEXT NOT NULL,
    "portfolioShared" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedByMembershipId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerCredential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CareerCredential_issuerOrganizationId_fkey" FOREIGN KEY ("issuerOrganizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerEligibilityReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE',
    "requestedAt" DATETIME,
    "reviewedByAdminId" TEXT,
    "reviewedAt" DATETIME,
    "decisionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerEligibilityReview_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employerOrganizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsibilities" TEXT,
    "requiredSkills" TEXT,
    "preferredSkills" TEXT,
    "location" TEXT,
    "workMode" TEXT,
    "opportunityType" TEXT NOT NULL,
    "compensationDescription" TEXT,
    "applicationDeadline" DATETIME,
    "eligibilityDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedByAdminId" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerOpportunity_employerOrganizationId_fkey" FOREIGN KEY ("employerOrganizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "snapshotJson" TEXT NOT NULL,
    "contactSharingConsent" BOOLEAN NOT NULL DEFAULT false,
    "employerNotes" TEXT,
    "candidateVisibleStatusNote" TEXT,
    "withdrawnAt" DATETIME,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerApplication_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CareerOpportunity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CareerApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerSafetyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerSafetyReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ClassSession" (
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
    "audience" TEXT DEFAULT 'PUBLIC',
    "organizationId" TEXT,
    "organizationGroupId" TEXT,
    CONSTRAINT "ClassSession_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ClassSession_organizationGroupId_fkey" FOREIGN KEY ("organizationGroupId") REFERENCES "OrganizationGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ClassSession" ("bookedCount", "cancelledAt", "capacity", "createdAt", "description", "durationMinutes", "id", "language", "minimumStudents", "plannedPricePaise", "publishedAt", "startsAt", "status", "subject", "targetLevel", "teacherProfileId", "timeZone", "title", "updatedAt") SELECT "bookedCount", "cancelledAt", "capacity", "createdAt", "description", "durationMinutes", "id", "language", "minimumStudents", "plannedPricePaise", "publishedAt", "startsAt", "status", "subject", "targetLevel", "teacherProfileId", "timeZone", "title", "updatedAt" FROM "ClassSession";
DROP TABLE "ClassSession";
ALTER TABLE "new_ClassSession" RENAME TO "ClassSession";
CREATE INDEX "ClassSession_status_startsAt_idx" ON "ClassSession"("status", "startsAt");
CREATE INDEX "ClassSession_teacherProfileId_startsAt_idx" ON "ClassSession"("teacherProfileId", "startsAt");
CREATE INDEX "ClassSession_organizationId_audience_idx" ON "ClassSession"("organizationId", "audience");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_verificationStatus_idx" ON "Organization"("verificationStatus");

-- CreateIndex
CREATE INDEX "Organization_orgType_idx" ON "Organization"("orgType");

-- CreateIndex
CREATE INDEX "OrganizationMembership_studentId_idx" ON "OrganizationMembership"("studentId");

-- CreateIndex
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_studentId_key" ON "OrganizationMembership"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_organizationId_idx" ON "OrganizationInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationGroup_organizationId_status_idx" ON "OrganizationGroup"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationGroupMembership_membershipId_idx" ON "OrganizationGroupMembership"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationGroupMembership_groupId_membershipId_key" ON "OrganizationGroupMembership"("groupId", "membershipId");

-- CreateIndex
CREATE INDEX "OrganizationAuditEvent_organizationId_createdAt_idx" ON "OrganizationAuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizationAuditEvent_entityType_entityId_idx" ON "OrganizationAuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "OrganizationAnnouncement_organizationId_status_idx" ON "OrganizationAnnouncement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationResource_organizationId_idx" ON "OrganizationResource"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationAssignment_organizationId_groupId_status_idx" ON "OrganizationAssignment"("organizationId", "groupId", "status");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_assignmentId_status_idx" ON "AssignmentSubmission"("assignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerProfile_studentId_key" ON "CareerProfile"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerProfile_publicSlug_key" ON "CareerProfile"("publicSlug");

-- CreateIndex
CREATE INDEX "CareerProfile_visibility_idx" ON "CareerProfile"("visibility");

-- CreateIndex
CREATE INDEX "StudentCareerSkill_studentId_position_idx" ON "StudentCareerSkill"("studentId", "position");

-- CreateIndex
CREATE INDEX "CareerProject_studentId_visibility_idx" ON "CareerProject"("studentId", "visibility");

-- CreateIndex
CREATE INDEX "CareerCredential_studentId_status_idx" ON "CareerCredential"("studentId", "status");

-- CreateIndex
CREATE INDEX "CareerCredential_issuerOrganizationId_idx" ON "CareerCredential"("issuerOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerEligibilityReview_studentId_key" ON "CareerEligibilityReview"("studentId");

-- CreateIndex
CREATE INDEX "CareerEligibilityReview_status_idx" ON "CareerEligibilityReview"("status");

-- CreateIndex
CREATE INDEX "CareerOpportunity_status_opportunityType_idx" ON "CareerOpportunity"("status", "opportunityType");

-- CreateIndex
CREATE INDEX "CareerOpportunity_employerOrganizationId_status_idx" ON "CareerOpportunity"("employerOrganizationId", "status");

-- CreateIndex
CREATE INDEX "CareerApplication_studentId_status_idx" ON "CareerApplication"("studentId", "status");

-- CreateIndex
CREATE INDEX "CareerApplication_opportunityId_status_idx" ON "CareerApplication"("opportunityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareerApplication_opportunityId_studentId_key" ON "CareerApplication"("opportunityId", "studentId");

-- CreateIndex
CREATE INDEX "CareerSafetyReport_status_idx" ON "CareerSafetyReport"("status");

-- CreateIndex
CREATE INDEX "CareerSafetyReport_reporterId_idx" ON "CareerSafetyReport"("reporterId");

-- CreateIndex
CREATE INDEX "CareerAuditEvent_entityType_entityId_idx" ON "CareerAuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CareerAuditEvent_createdAt_idx" ON "CareerAuditEvent"("createdAt");
