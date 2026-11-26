// ─── BEAN Classroom Intelligence (CI-6E): invitation & recruitment operations ──
// Admin-controlled recruitment tools. Security invariants:
//   • The RAW token is generated once, returned exactly once at creation, and
//     only its SHA-256 hash is ever stored. Tokens never appear in logs,
//     listings, or error messages.
//   • Single-use: claiming is a guarded PENDING → CLAIMED transition bound to
//     the signed-in account (server-resolved). Replay, expiry and revocation
//     all refuse.
//   • A claimed invitation STARTS OR LINKS an application — it never creates
//     reviewer eligibility, verification state, or any privilege. The claimed
//     context is advisory data the applicant may attach to their application.
//   • No email delivery is claimed or attempted: administrators copy the
//     secure claim link and share it through their own channel.

import { z } from 'zod'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { REVIEWER_CATEGORY } from './reviewers'

export const INVITATION_STATUS = ['PENDING', 'CLAIMED', 'EXPIRED', 'REVOKED'] as const
export type InvitationStatus = (typeof INVITATION_STATUS)[number]

export const INVITATION_MAX_VALID_DAYS = 90
export const INVITATION_DEFAULT_VALID_DAYS = 14

// ─── Structural DB view ────────────────────────────────────────────────────────

export interface InvitationRow {
  id: string
  tokenHash: string
  category: string
  requestedDomainsJson: string
  requestedLanguagesJson: string
  note: string | null
  status: string
  createdByAdminId: string
  expiresAt: Date
  claimedByStudentId: string | null
  claimedAt: Date | null
  revokedReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InvitationsDb {
  expertInvitation: {
    create(args: { data: Record<string, unknown> }): Promise<InvitationRow>
    findUnique(args: { where: Record<string, unknown> }): Promise<InvitationRow | null>
    findMany(args?: Record<string, unknown>): Promise<InvitationRow[]>
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<InvitationRow>
  }
  expertReviewerProfile: {
    findUnique(args: { where: Record<string, unknown> }): Promise<{ id: string; studentId: string; status: string } | null>
  }
  expertReviewerEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
}

export function invitationsDbFromPrisma(client: unknown): InvitationsDb {
  return client as InvitationsDb
}

export type InvitationOpResult<T = undefined> =
  | { ok: true; invitation: InvitationRow; value?: T }
  | { ok: false; status: number; error: string }

// ─── Create (raw token shown exactly once) ─────────────────────────────────────

export interface CreatedInvitation {
  invitation: InvitationRow
  /** Raw token — returned ONCE by the create path; never stored or listed. */
  rawToken: string
  /** Claim URL fragment (hash route) carrying the raw token. */
  claimUrl: string
}

const createSchema = z.object({
  category: z.enum(REVIEWER_CATEGORY),
  requestedDomains: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/)).max(20).optional(),
  requestedLanguages: z.array(z.object({ tag: z.string().min(2).max(12), tasks: z.array(z.string()).max(8) }).strict()).max(10).optional(),
  note: z.string().max(500).optional(),
  validDays: z.number().int().min(1).max(INVITATION_MAX_VALID_DAYS).optional(),
}).strict()

export async function createInvitation(
  db: InvitationsDb,
  admin: { studentId: string; displayName: string },
  input: unknown,
): Promise<InvitationOpResult<CreatedInvitation>> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid invitation: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const data = parsed.data
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const validDays = data.validDays ?? INVITATION_DEFAULT_VALID_DAYS
  const created = await db.expertInvitation.create({
    data: {
      id: `inv_${randomUUID().replace(/-/g, '')}`,
      tokenHash,
      category: data.category,
      requestedDomainsJson: JSON.stringify(data.requestedDomains ?? []),
      requestedLanguagesJson: JSON.stringify(data.requestedLanguages ?? []),
      note: data.note ?? null,
      status: 'PENDING',
      createdByAdminId: admin.studentId,
      expiresAt: new Date(Date.now() + validDays * 86_400_000),
    },
  })
  return {
    ok: true,
    invitation: created,
    value: {
      invitation: created,
      rawToken,
      claimUrl: `#/expert-apply?invite=${rawToken}`,
    },
  }
}

// ─── Admin listing (never contains token material) ────────────────────────────

export async function listInvitations(db: InvitationsDb, filter: { status?: string } = {}): Promise<InvitationRow[]> {
  return db.expertInvitation.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    orderBy: { createdAt: 'desc' },
  }) as Promise<InvitationRow[]>
}

export async function revokeInvitation(
  db: InvitationsDb,
  admin: { studentId: string; displayName: string },
  invitationId: string,
  reason: string,
): Promise<InvitationOpResult> {
  if (!reason || reason.trim().length < 10) {
    return { ok: false, status: 400, error: 'a revocation reason is required (min 10 chars)' }
  }
  const invitation = await db.expertInvitation.findUnique({ where: { id: invitationId } })
  if (!invitation) return { ok: false, status: 404, error: 'invitation not found' }
  if (invitation.status !== 'PENDING') {
    return { ok: false, status: 409, error: `invitation is ${invitation.status} — only pending invitations can be revoked` }
  }
  const updated = await db.expertInvitation.update({
    where: { id: invitation.id },
    data: { status: 'REVOKED', revokedReason: reason.slice(0, 500) },
  })
  return { ok: true, invitation: updated }
}

// ─── Claim (single-use; starts/links an application; grants NOTHING) ───────────

export interface ClaimContext {
  invitationId: string
  category: string
  requestedDomains: string[]
  requestedLanguages: Array<{ tag: string; tasks: string[] }>
  note: string | null
  linkedProfileId: string | null
}

export async function claimInvitation(
  db: InvitationsDb,
  actor: { studentId: string; displayName: string },
  rawToken: string,
  now: Date = new Date(),
): Promise<InvitationOpResult<ClaimContext>> {
  if (!rawToken || rawToken.length < 16 || rawToken.length > 200) {
    return { ok: false, status: 400, error: 'invalid invitation token' }
  }
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const invitation = await db.expertInvitation.findUnique({ where: { tokenHash } })
  if (!invitation) return { ok: false, status: 404, error: 'invitation not found or no longer valid' }
  if (invitation.status === 'EXPIRED' || invitation.status === 'REVOKED') {
    return { ok: false, status: 409, error: `invitation is ${invitation.status.toLowerCase()} and cannot be claimed` }
  }
  if (invitation.status === 'CLAIMED') {
    return { ok: false, status: 409, error: 'invitation has already been claimed — invitation tokens are single-use' }
  }
  if (invitation.expiresAt.getTime() < now.getTime()) {
    // Lazy expiry on read (deterministic, honest).
    await db.expertInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } })
    return { ok: false, status: 409, error: 'invitation has expired' }
  }
  const claimed = await db.expertInvitation.update({
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'CLAIMED', claimedByStudentId: actor.studentId, claimedAt: now },
  })
  // Link to an existing application when the account already has one; the
  // claim itself never changes application state or grants privileges.
  const profile = await db.expertReviewerProfile.findUnique({ where: { studentId: actor.studentId } })
  if (profile) {
    await db.expertReviewerEvent.create({
      data: {
        profileId: profile.id,
        eventType: 'INVITATION_CLAIMED',
        actorKind: 'REVIEWER',
        actorId: actor.studentId,
        rationale: `claimed expert invitation ${invitation.id} (${invitation.category}) — advisory scope link only, no privilege granted`,
        payload: JSON.stringify({ invitationId: invitation.id, category: invitation.category }),
      },
    })
  }
  const context: ClaimContext = {
    invitationId: claimed.id,
    category: claimed.category,
    requestedDomains: safeJsonArray(claimed.requestedDomainsJson),
    requestedLanguages: safeJsonObjects(claimed.requestedLanguagesJson),
    note: claimed.note,
    linkedProfileId: profile?.id ?? null,
  }
  return { ok: true, invitation: claimed, value: context }
}

/**
 * Validate an invitation link for an application being submitted: the
 * invitation must be CLAIMED by THIS account. Used by the application path to
 * record provenance (the invitation is linked, never privileged).
 */
export async function validateInvitationLink(db: InvitationsDb, studentId: string, invitationId: string): Promise<{ ok: true; invitation: InvitationRow } | { ok: false; status: number; error: string }> {
  const invitation = await db.expertInvitation.findUnique({ where: { id: invitationId } })
  if (!invitation) return { ok: false, status: 404, error: 'invitation not found' }
  if (invitation.status !== 'CLAIMED' || invitation.claimedByStudentId !== studentId) {
    return { ok: false, status: 400, error: 'invitation was not claimed by this account — it cannot be linked to the application' }
  }
  return { ok: true, invitation }
}

function safeJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : []
  } catch {
    return []
  }
}

function safeJsonObjects(raw: string): Array<{ tag: string; tasks: string[] }> {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && typeof (x as { tag?: unknown }).tag === 'string') as Array<{ tag: string; tasks: string[] }>) : []
  } catch {
    return []
  }
}
