// ─── BEAN Institution Workspace (Phase 7): privacy-safe DTO mappers ──────────
// Every Phase 7 organization API response is shaped here. Rules:
//   • Public organization data never includes private admin notes
//     (verificationNote, rejectionReason shown only to admins and, where
//     appropriate, the organization's own admins after a decision).
//   • Member lists expose displayName + membership role only — never emails,
//     account emails or private student data.
//   • Audit events are admin/institution-facing; student private data never
//     appears in detail strings.

import type {
  Organization,
  OrganizationAnnouncement,
  OrganizationAssignment,
  OrganizationGroup,
  OrganizationInvitation,
  OrganizationMembership,
  OrganizationResource,
} from '@prisma/client'

export interface PublicOrganizationDTO {
  id: string
  name: string
  displayName: string | null
  orgType: string
  description: string | null
  website: string | null
  publicContact: string | null
  country: string | null
  state: string | null
  city: string | null
  slug: string
  logoText: string | null
  /** Truthful label source: DRAFT | PENDING_REVIEW | APPROVED | REJECTED | SUSPENDED. */
  verificationStatus: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function toPublicOrganization(org: Organization): PublicOrganizationDTO {
  return {
    id: org.id,
    name: org.name,
    displayName: org.displayName,
    orgType: org.orgType,
    description: org.description,
    website: org.website,
    publicContact: org.publicContact,
    country: org.country,
    state: org.state,
    city: org.city,
    slug: org.slug,
    logoText: org.logoText,
    verificationStatus: org.verificationStatus,
    isActive: org.isActive,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  }
}

/** Organization's own view — includes verification decision reason, never the admin's private note. */
export function toOwnOrganization(org: Organization): PublicOrganizationDTO & { rejectionReason: string | null } {
  return { ...toPublicOrganization(org), rejectionReason: org.rejectionReason }
}

export interface MemberDTO {
  id: string
  role: string
  status: string
  student: { displayName: string | null }
  joinedAt: string | null
  activatedAt: string | null
  suspendedAt: string | null
  leftAt: string | null
}

export function toMemberDTO(m: OrganizationMembership & { student: { displayName: string | null } }): MemberDTO {
  return {
    id: m.id,
    role: m.role,
    status: m.status,
    student: { displayName: m.student.displayName },
    joinedAt: m.createdAt.toISOString(),
    activatedAt: m.activatedAt?.toISOString() ?? null,
    suspendedAt: m.suspendedAt?.toISOString() ?? null,
    leftAt: m.leftAt?.toISOString() ?? null,
  }
}

export interface InvitationDTO {
  id: string
  email: string | null
  intendedRole: string
  expiresAt: string
  maxUses: number | null
  useCount: number
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
  /** Only ever set at creation time in the POST response — never listed. */
  rawToken?: string
}

export function toInvitationDTO(i: OrganizationInvitation): InvitationDTO {
  return {
    id: i.id,
    email: i.email,
    intendedRole: i.intendedRole,
    expiresAt: i.expiresAt.toISOString(),
    maxUses: i.maxUses,
    useCount: i.useCount,
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  }
}

export interface GroupDTO {
  id: string
  name: string
  academicYear: string | null
  programmeLabel: string | null
  batchLabel: string | null
  sectionLabel: string | null
  trackLabel: string | null
  startsAt: string | null
  endsAt: string | null
  capacity: number | null
  status: string
  activeEnrollmentCount: number
  createdAt: string
}

export function toGroupDTO(g: OrganizationGroup & { _count?: { enrollments: number } }): GroupDTO {
  return {
    id: g.id,
    name: g.name,
    academicYear: g.academicYear,
    programmeLabel: g.programmeLabel,
    batchLabel: g.batchLabel,
    sectionLabel: g.sectionLabel,
    trackLabel: g.trackLabel,
    startsAt: g.startsAt?.toISOString() ?? null,
    endsAt: g.endsAt?.toISOString() ?? null,
    capacity: g.capacity,
    status: g.status,
    activeEnrollmentCount: g._count?.enrollments ?? 0,
    createdAt: g.createdAt.toISOString(),
  }
}

export interface AssignmentDTO {
  id: string
  groupId: string
  title: string
  instructions: string | null
  subjectLabel: string | null
  submissionType: string
  status: string
  dueAt: string | null
  maxScore: number | null
  publishedAt: string | null
  createdAt: string
}

export function toAssignmentDTO(a: OrganizationAssignment): AssignmentDTO {
  return {
    id: a.id,
    groupId: a.groupId,
    title: a.title,
    instructions: a.instructions,
    subjectLabel: a.subjectLabel,
    submissionType: a.submissionType,
    status: a.status,
    dueAt: a.dueAt?.toISOString() ?? null,
    maxScore: a.maxScore,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }
}

export interface AnnouncementDTO {
  id: string
  groupId: string | null
  title: string
  body: string
  status: string
  publishedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export function toAnnouncementDTO(a: OrganizationAnnouncement): AnnouncementDTO {
  return {
    id: a.id,
    groupId: a.groupId,
    title: a.title,
    body: a.body,
    status: a.status,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }
}

export interface ResourceDTO {
  id: string
  groupId: string | null
  title: string
  description: string | null
  url: string
  createdAt: string
}

export function toResourceDTO(r: OrganizationResource): ResourceDTO {
  return {
    id: r.id,
    groupId: r.groupId,
    title: r.title,
    description: r.description,
    url: r.url,
    createdAt: r.createdAt.toISOString(),
  }
}
