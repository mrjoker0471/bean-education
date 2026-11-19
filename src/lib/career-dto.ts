// ─── BEAN Career Portfolio (Phase 7): privacy-safe DTO mappers ───────────────
// Rules:
//   • Student DTOs contain the student's own data; employerNotes never appear
//     in any student-facing DTO.
//   • Public/discoverable DTOs never include account ids, emails, phone
//     numbers or private learning data — skills/projects/credentials appear
//     only when the student individually shared them.
//   • Employer-facing application DTOs carry the submission-time snapshot and
//     contact details ONLY when the applicant gave explicit consent.
//   • Credential DTOs distinguish issued vs revoked truthfully.

import type {
  CareerApplication,
  CareerCredential,
  CareerEligibilityReview,
  CareerOpportunity,
  CareerProject,
  CareerProfile,
  CareerSafetyReport,
  Organization,
  StudentCareerSkill,
} from '@prisma/client'

export interface CareerProfileDTO {
  id: string
  headline: string | null
  summary: string | null
  preferredRoleTypes: string[]
  preferredSkills: string[]
  preferredLocations: string[]
  workModes: string[]
  visibility: string
  publicSlug: string | null
  createdAt: string
  updatedAt: string
}

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function toCareerProfileDTO(p: CareerProfile): CareerProfileDTO {
  return {
    id: p.id,
    headline: p.headline,
    summary: p.summary,
    preferredRoleTypes: parseList(p.preferredRoleTypes),
    preferredSkills: parseList(p.preferredSkills),
    preferredLocations: parseList(p.preferredLocations),
    workModes: parseList(p.workModes),
    visibility: p.visibility,
    publicSlug: p.publicSlug,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export interface SkillDTO {
  id: string
  skillName: string
  proficiency: string | null
  description: string | null
  verificationLabel: string
  sourceRef: string | null
  position: number
}

export function toSkillDTO(s: StudentCareerSkill): SkillDTO {
  return {
    id: s.id,
    skillName: s.skillName,
    proficiency: s.proficiency,
    description: s.description,
    verificationLabel: s.verificationLabel,
    sourceRef: s.sourceRef,
    position: s.position,
  }
}

export interface ProjectDTO {
  id: string
  title: string
  description: string | null
  category: string | null
  skillsUsed: string[]
  projectUrl: string | null
  startsAt: string | null
  endsAt: string | null
  visibility: string
  status: string
}

export function toProjectDTO(p: CareerProject): ProjectDTO {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    skillsUsed: parseList(p.skillsUsed),
    projectUrl: p.projectUrl,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    visibility: p.visibility,
    status: p.status,
  }
}

export interface CredentialDTO {
  id: string
  credentialName: string
  credentialDescription: string | null
  issuedDate: string
  expiryDate: string | null
  credentialReference: string | null
  status: string
  portfolioShared: boolean
  /** Flattened issuer name for portfolio display (displayName, else official name). */
  issuerName: string
  issuer: { id: string; name: string; displayName: string | null; verificationStatus: string }
}

export function toCredentialDTO(
  c: CareerCredential & { issuerOrganization: Pick<Organization, 'id' | 'name' | 'displayName' | 'verificationStatus'> },
): CredentialDTO {
  return {
    id: c.id,
    credentialName: c.credentialName,
    credentialDescription: c.credentialDescription,
    issuedDate: c.issuedDate.toISOString(),
    expiryDate: c.expiryDate?.toISOString() ?? null,
    credentialReference: c.credentialReference,
    status: c.status,
    portfolioShared: c.portfolioShared,
    issuerName: c.issuerOrganization.displayName ?? c.issuerOrganization.name,
    issuer: {
      id: c.issuerOrganization.id,
      name: c.issuerOrganization.name,
      displayName: c.issuerOrganization.displayName,
      verificationStatus: c.issuerOrganization.verificationStatus,
    },
  }
}

export interface EligibilityDTO {
  status: string
  requestedAt: string | null
  reviewedAt: string | null
  decisionReason: string | null
}

export function toEligibilityDTO(e: CareerEligibilityReview | null): EligibilityDTO {
  if (!e) return { status: 'NOT_ELIGIBLE', requestedAt: null, reviewedAt: null, decisionReason: null }
  return {
    status: e.status,
    requestedAt: e.requestedAt?.toISOString() ?? null,
    reviewedAt: e.reviewedAt?.toISOString() ?? null,
    decisionReason: e.decisionReason,
  }
}

export interface PublicOpportunityDTO {
  id: string
  title: string
  description: string
  responsibilities: string | null
  requiredSkills: string[]
  preferredSkills: string[]
  location: string | null
  workMode: string | null
  opportunityType: string
  compensationDescription: string | null
  applicationDeadline: string | null
  eligibilityDescription: string | null
  status: string
  organization: { id: string; name: string; displayName: string | null; verificationStatus: string; logoText: string | null }
  publishedAt: string | null
}

export function toPublicOpportunityDTO(o: CareerOpportunity & { organization: Organization }): PublicOpportunityDTO {
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    responsibilities: o.responsibilities,
    requiredSkills: parseList(o.requiredSkills),
    preferredSkills: parseList(o.preferredSkills),
    location: o.location,
    workMode: o.workMode,
    opportunityType: o.opportunityType,
    compensationDescription: o.compensationDescription,
    applicationDeadline: o.applicationDeadline?.toISOString() ?? null,
    eligibilityDescription: o.eligibilityDescription,
    status: o.status,
    organization: {
      id: o.organization.id,
      name: o.organization.name,
      displayName: o.organization.displayName,
      verificationStatus: o.organization.verificationStatus,
      logoText: o.organization.logoText,
    },
    publishedAt: o.publishedAt?.toISOString() ?? null,
  }
}

export interface OwnApplicationDTO {
  id: string
  status: string
  submittedAt: string
  updatedAt: string
  candidateVisibleStatusNote: string | null
  opportunity: { id: string; title: string; opportunityType: string; organizationName: string; applicationDeadline: string | null }
}

export function toOwnApplicationDTO(
  a: CareerApplication & { opportunity: CareerOpportunity & { organization: Organization } },
): OwnApplicationDTO {
  return {
    id: a.id,
    status: a.status,
    submittedAt: a.submittedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    candidateVisibleStatusNote: a.candidateVisibleStatusNote,
    opportunity: {
      id: a.opportunity.id,
      title: a.opportunity.title,
      opportunityType: a.opportunity.opportunityType,
      organizationName: a.opportunity.organization.displayName ?? a.opportunity.organization.name,
      applicationDeadline: a.opportunity.applicationDeadline?.toISOString() ?? null,
    },
  }
}

export interface ApplicationDetailDTO {
  id: string
  status: string
  submittedAt: string
  updatedAt: string
  candidateVisibleStatusNote: string | null
  /** Explicit consent flag — contact details surface only when true. */
  contactSharingConsent: boolean
  /** The applicant's own submission-time snapshot, verbatim (bounded JSON). */
  snapshot: Record<string, unknown>
  opportunity: {
    id: string
    title: string
    opportunityType: string
    location: string | null
    workMode: string | null
    applicationDeadline: string | null
  }
  organization: { id: string; name: string; verificationStatus: string }
}

/**
 * Owner-facing application detail. employerNotes is deliberately absent —
 * this mapper is only used on routes guarded by studentId ownership.
 */
export function toApplicationDetailDTO(
  a: CareerApplication & {
    opportunity: CareerOpportunity & { organization: Pick<Organization, 'id' | 'name' | 'verificationStatus'> }
  },
): ApplicationDetailDTO {
  let snapshot: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(a.snapshotJson) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) snapshot = parsed as Record<string, unknown>
  } catch {
    snapshot = {}
  }
  return {
    id: a.id,
    status: a.status,
    submittedAt: a.submittedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    candidateVisibleStatusNote: a.candidateVisibleStatusNote,
    contactSharingConsent: a.contactSharingConsent,
    snapshot,
    opportunity: {
      id: a.opportunity.id,
      title: a.opportunity.title,
      opportunityType: a.opportunity.opportunityType,
      location: a.opportunity.location,
      workMode: a.opportunity.workMode,
      applicationDeadline: a.opportunity.applicationDeadline?.toISOString() ?? null,
    },
    organization: {
      id: a.opportunity.organization.id,
      name: a.opportunity.organization.name,
      verificationStatus: a.opportunity.organization.verificationStatus,
    },
  }
}

export interface EmployerApplicationDTO {
  id: string
  status: string
  submittedAt: string
  candidateVisibleStatusNote: string | null
  applicant: {
    /** Candidate-chosen display identity from the snapshot — never an account id/email. */
    headline: string | null
    summary: string | null
    skills: unknown
    projects: unknown
    credentials: unknown
  }
  contact: { email?: string } | null
  employerNotes: string | null
}

/**
 * Employer-facing mapper. The snapshot is shown verbatim (it is what the
 * candidate explicitly shared at submission time); contact details surface
 * ONLY with explicit consent. employerNotes is included for the employer's
 * own private record — this mapper is never used in student DTOs.
 */
export function toEmployerApplicationDTO(a: CareerApplication): EmployerApplicationDTO {
  let snapshot: Record<string, unknown> = {}
  try {
    snapshot = JSON.parse(a.snapshotJson) as Record<string, unknown>
  } catch {
    snapshot = {}
  }
  const contact =
    a.contactSharingConsent && typeof snapshot['shareContact'] === 'object' && snapshot['shareContact'] !== null
      ? (snapshot['shareContact'] as { email?: string })
      : null
  return {
    id: a.id,
    status: a.status,
    submittedAt: a.submittedAt.toISOString(),
    candidateVisibleStatusNote: a.candidateVisibleStatusNote,
    applicant: {
      headline: typeof snapshot['headline'] === 'string' ? snapshot['headline'] : null,
      summary: typeof snapshot['summary'] === 'string' ? snapshot['summary'] : null,
      skills: snapshot['skills'] ?? [],
      projects: snapshot['projects'] ?? [],
      credentials: snapshot['credentials'] ?? [],
    },
    contact,
    employerNotes: a.employerNotes,
  }
}

export interface DiscoverableCandidateDTO {
  headline: string | null
  summaryPreview: string | null
  preferredRoleTypes: string[]
  preferredSkills: string[]
  preferredLocations: string[]
  workModes: string[]
  skills: SkillDTO[]
  projects: ProjectDTO[]
  credentials: CredentialDTO[]
  /** Opaque reference derived from the profile id — never a raw Student id. */
  candidateRef: string
}

/**
 * Discovery mapper: candidate-approved fields only. The summary is truncated
 * to a preview; full contact is never included (contact happens through an
 * application the candidate submits with explicit consent).
 */
export function toDiscoverableCandidateDTO(
  p: CareerProfile & {
    student: {
      careerSkills: StudentCareerSkill[]
      careerProjects: CareerProject[]
      careerCredentials: (CareerCredential & { issuerOrganization: Pick<Organization, 'id' | 'name' | 'displayName' | 'verificationStatus'> })[]
    }
  },
): DiscoverableCandidateDTO {
  return {
    headline: p.headline,
    summaryPreview: p.summary ? p.summary.slice(0, 240) : null,
    preferredRoleTypes: parseList(p.preferredRoleTypes),
    preferredSkills: parseList(p.preferredSkills),
    preferredLocations: parseList(p.preferredLocations),
    workModes: parseList(p.workModes),
    skills: p.student.careerSkills.map(toSkillDTO),
    projects: p.student.careerProjects.map(toProjectDTO),
    credentials: p.student.careerCredentials.map(toCredentialDTO),
    candidateRef: `c_${Buffer.from(p.id).toString('base64url')}`,
  }
}

export interface OwnReportDTO {
  id: string
  targetType: string
  targetId: string
  category: string
  subject: string
  status: string
  createdAt: string
  resolutionVisible: string | null
}

export function toOwnReportDTO(r: CareerSafetyReport): OwnReportDTO {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    category: r.category,
    subject: r.subject,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolutionVisible: r.status === 'RESOLVED' || r.status === 'DISMISSED' ? 'The review of this report is complete.' : null,
  }
}
