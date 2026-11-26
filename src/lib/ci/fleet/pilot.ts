// ─── BEAN Classroom Intelligence (CI-7B): controlled real expert pilot ───────
// Protocol constants and read-only derivations for the CI-7 pilot.
//
// DESIGN RULES (charter CI-7 §2):
// - This module NEVER replaces an existing authority. It pins the pilot
//   protocol's governing constants and derives pilot facts from the EXISTING
//   CI-4/CI-5/CI-6 ledgers (registry, curator reviews, reviewer profiles,
//   assignments, benchmark labels). Where an existing gate applies, the pilot
//   calls it — it does not re-implement it.
// - Every real count is derived from an authoritative ledger; missing values
//   are never calculated as successful outcomes. Until genuine humans complete
//   the real process, cohort/review/approval counts are honestly zero.
// - The pilot is restricted to non-consequential educational knowledge
//   validation (protocol §3). It never touches student data, transcription,
//   payments, admissions, hiring or any consequential decision.

import {
  computePackChecksum,
  getDomainPack,
  listDomainPacks,
  type DomainPack,
} from './domain-packs'
import { resolveCuratedStatus, type CuratedStatusResult } from './curator'
import { assertSourceContentUsable, listSources } from './sources'
import type { ReviewerDb, ReviewerProfileRow, ReviewerActor } from './reviewers'

/** Version of the pilot protocol these constants encode (protocol document §header). */
export const CI7_PILOT_PROTOCOL_VERSION = 'ci7-pilot-protocol-1'

/** The recommended pilot subject (CI-7A readiness audit; owner approval is gate G1). */
export const CI7_PILOT_DOMAIN_ID = 'education-pedagogy'
export const CI7_PILOT_PACK_VERSION = '1.0.0'

/**
 * Independent reviews the pilot requires before any acceptance evaluation.
 *
 * The EXISTING approval policy for a STANDARD pack requires 1 distinct
 * qualified approver (resolveCuratedStatus) — CI-7 never relaxes that. The
 * pilot deliberately requires MORE: at least two independent completed reviews
 * by two different verified experts, so genuine disagreement can be observed,
 * preserved and (where needed) adjudicated rather than hidden behind the
 * single-approval minimum.
 */
export const CI7_PILOT_MIN_INDEPENDENT_REVIEWS = 2

/** Hard exclusions (protocol §3) — recorded here so tests and reporting can bind to them. */
export const CI7_PILOT_EXCLUDED_USES: readonly string[] = [
  'student assessment decisions (grades, progress judgements, promotion/retention)',
  'payment, pricing, admissions, hiring, employment or institutional high-stakes decisions',
  'diagnosis of learning disabilities or health conditions; replacement of a qualified special-educational-needs assessment',
  'public ranking or grading of any named student',
  'retention/discipline decisions for any individual learner',
  'transcription, audio/video recording, or any voice capability (TRANSCRIPTION stays structurally UNSUPPORTED)',
  'global activation of the pack beyond the bounded restricted pilot scope',
  'use of quarantined or reference-only external material as content',
  'benchmark publication or model-performance claims beyond the CI-7F evidence rules',
]

/** Stop conditions (protocol §13) — any one halts the pilot. */
export const CI7_PILOT_STOP_CONDITIONS: readonly string[] = [
  'any attempt to use pilot output in a consequential decision',
  'credential verification cannot be completed honestly for a participant',
  'pack checksum drift without version-bound re-review',
  'licence status change on any cited source',
  'adjudication deadlock (recorded honestly, never resolved by forced consensus)',
  'evidence of a fabricated identity or credential',
  'owner authorisation withdrawn at any gate',
]

/**
 * Snapshot of the pilot pack as it exists RIGHT NOW, plus the protocol
 * discipline around it. Throws when the registry no longer matches the
 * protocol's pinned subject — CI-7 must fail loudly on drift rather than
 * silently review a different pack than the protocol describes.
 */
export function pilotPackSnapshot(): {
  protocolVersion: string
  domainId: string
  pack: DomainPack
  checksum: string
  approvalsRequired: number
  declaredStatus: string
  humanReviewRecorded: boolean
  sourceLicenceSnapshot: Array<{
    sourceId: string
    publisher: string
    version: string
    restrictions: string[]
    contentUsable: boolean
    reason: string | null
  }>
} {
  const found = getDomainPack(CI7_PILOT_DOMAIN_ID)
  if (!found) {
    throw new Error(`pilot protocol drift: domain ${CI7_PILOT_DOMAIN_ID} is not registered`)
  }
  const { pack, checksum } = found
  if (pack.packVersion !== CI7_PILOT_PACK_VERSION) {
    throw new Error(
      `pilot protocol drift: pack version ${pack.packVersion} != protocol ${CI7_PILOT_PACK_VERSION} — the protocol must be re-approved for the new version (gate G2)`,
    )
  }
  // derivation comes from the EXISTING curator authority (never re-implemented)
  const curated: CuratedStatusResult = resolveCuratedStatus(pack, [])
  const licenceSnapshot = pack.sources.map((citation) => {
    const gate = assertSourceContentUsable(citation.sourceId, { commercialOperation: true })
    const record = listSources().find((s) => s.sourceId === citation.sourceId) ?? null
    return {
      sourceId: citation.sourceId,
      publisher: record?.publisher ?? 'unknown',
      version: record?.version ?? 'unknown',
      restrictions: record?.licence.restrictions ?? [],
      contentUsable: gate.usable,
      reason: gate.usable ? null : (gate.reason ?? 'content not usable'),
    }
  })
  return {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
    domainId: CI7_PILOT_DOMAIN_ID,
    pack,
    checksum,
    approvalsRequired: curated.approvalsRequired,
    declaredStatus: pack.status,
    humanReviewRecorded: pack.humanReview !== null,
    sourceLicenceSnapshot: licenceSnapshot,
  }
}


/**
 * Guard against the protocol's subject silently disappearing from the
 * registry (e.g. a future pack retirement). Used by tests and reporting.
 */
export function pilotSubjectIsRegistered(): boolean {
  return listDomainPacks().some((p) => p.pack.domainId === CI7_PILOT_DOMAIN_ID)
}

// ─── CI-7C: expert cohort activation — pilot participation consent ───────────
// The cohort is NOT a second onboarding system: it reuses the existing CI-6
// flow (INVITE → APPLY → EVIDENCE → INDEPENDENT VERIFICATION → QUALIFICATION
// → ACTIVATION) and adds exactly one missing gate — explicit pilot
// participation consent, recorded as append-only reviewer events so the
// participant's acknowledgement of the protocol terms is auditable and the
// latest event governs.

/** Protocol participant information points every expert must acknowledge (protocol §15). */
export const CI7_PILOT_CONSENT_POINTS: readonly string[] = [
  'what-you-review: the education-pedagogy pack content (glossary, competency levels, task boundaries, safety boundary) against the six-section rubric',
  'how-decisions-are-used: append-only attributable review rows; genuine approvals can contribute to derived VERIFIED status; disagreements preserved and possibly adjudicated',
  'data-access: pack content, registered source metadata and licence snapshot — never student data, never other applicants evidence',
  'attribution: reviews are attributed to your reviewer identity in the audit ledger; public directory listing is optional and never a condition of participation',
  'compensation: the status recorded in the owner-approved participant terms (UNPAID | COMPENSATED | OTHERWISE_AGREED) — recorded verbatim, never invented',
  'confidentiality: pack content stays confidential outside BEAN; conflicts of interest must be declared and are enforced',
  'withdrawal-privacy: withdrawal runs through the existing reviewer withdrawal flow; consent events are retained in the audit trail per the retention rules',
]

export const CI7_PILOT_COMPENSATION_STATUSES = ['UNPAID', 'COMPENSATED', 'OTHERWISE_AGREED'] as const
export type Ci7PilotCompensationStatus = (typeof CI7_PILOT_COMPENSATION_STATUSES)[number]

const PILOT_CONSENT_STATUSES: readonly string[] = ['ACTIVE', 'APPROVED']

export interface Ci7PilotConsentInput {
  protocolVersion?: unknown
  acknowledged?: unknown
  compensationStatus?: unknown
}

/**
 * Record explicit pilot participation consent for an activated (or approved,
 * pre-activation) reviewer. Consent is the reviewer's own act — recorded with
 * the REVIEWER actor. This is NOT a privilege grant: eligibility still flows
 * from the CI-5B lifecycle (ACTIVE + scope + availability) and the CI-5C
 * assignment gates. Refuses:
 *  - profiles in states where participation makes no sense (pending review,
 *    terminal) — a pending applicant is never a pilot participant;
 *  - unknown protocol versions (consent must name the version it consented to);
 *  - missing/false acknowledgement of every participant information point;
 *  - an invented compensation status (only the owner-approved vocabulary).
 */
export async function recordPilotParticipationConsent(
  db: ReviewerDb,
  profile: ReviewerProfileRow,
  actor: ReviewerActor,
  input: Ci7PilotConsentInput,
  now: Date = new Date(),
): Promise<{ ok: true; eventId: string } | { ok: false; status: number; error: string }> {
  if (!PILOT_CONSENT_STATUSES.includes(profile.status)) {
    return {
      ok: false,
      status: 409,
      error: `pilot participation consent requires an APPROVED or ACTIVE reviewer profile (current status ${profile.status}) — a pending applicant is never a pilot participant, and terminal states cannot consent`,
    }
  }
  const protocolVersion = typeof input.protocolVersion === 'string' ? input.protocolVersion : ''
  if (!protocolVersion || protocolVersion !== CI7_PILOT_PROTOCOL_VERSION) {
    return { ok: false, status: 400, error: `consent must name the current pilot protocol version ${CI7_PILOT_PROTOCOL_VERSION}` }
  }
  const acknowledged = Array.isArray(input.acknowledged) ? (input.acknowledged as unknown[]) : []
  const missing = CI7_PILOT_CONSENT_POINTS.filter((point) => !acknowledged.includes(point))
  if (missing.length > 0) {
    return { ok: false, status: 400, error: `participation consent requires acknowledging every participant information point (missing ${missing.length})` }
  }
  const compensationStatus = input.compensationStatus
  if (
    typeof compensationStatus !== 'string' ||
    !CI7_PILOT_COMPENSATION_STATUSES.includes(compensationStatus as Ci7PilotCompensationStatus)
  ) {
    return { ok: false, status: 400, error: 'compensationStatus must record the owner-approved terms: UNPAID | COMPENSATED | OTHERWISE_AGREED — never an invented value' }
  }
  const event = await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'PILOT_PARTICIPATION_CONSENT',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: `consent to CI-7 pilot participation under ${protocolVersion} (education-pedagogy v${CI7_PILOT_PACK_VERSION})`,
      payload: JSON.stringify({
        kind: 'CI7-PILOT-PARTICIPATION',
        protocolVersion,
        packVersion: CI7_PILOT_PACK_VERSION,
        acknowledged: CI7_PILOT_CONSENT_POINTS,
        compensationStatus,
        consentedAt: now.toISOString(),
      }),
    },
  })
  return { ok: true, eventId: event.id }
}

/**
 * Withdraw pilot participation (append-only). The latest pilot event governs:
 * after withdrawal the reviewer is not a pilot participant. Existing recorded
 * decisions are retained per the retention rules — withdrawal never erases
 * history.
 */
export async function withdrawPilotParticipation(
  db: ReviewerDb,
  profile: ReviewerProfileRow,
  actor: ReviewerActor,
  reason: string,
  now: Date = new Date(),
): Promise<{ ok: true; eventId: string } | { ok: false; status: number; error: string }> {
  if (!reason || reason.trim().length < 10) {
    return { ok: false, status: 400, error: 'a withdrawal reason of at least 10 characters is required (audit trail)' }
  }
  const event = await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'PILOT_PARTICIPATION_WITHDRAWN',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: reason.slice(0, 2000),
      payload: JSON.stringify({
        kind: 'CI7-PILOT-PARTICIPATION-WITHDRAWAL',
        protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
        withdrawnAt: now.toISOString(),
      }),
    },
  })
  return { ok: true, eventId: event.id }
}

export interface Ci7PilotParticipationState {
  participant: boolean
  latestConsentAt: string | null
  latestWithdrawalAt: string | null
  protocolVersion: string | null
  compensationStatus: Ci7PilotCompensationStatus | null
}

/**
 * Derive pilot participation from the event ledger — the LATEST pilot consent
 * / withdrawal event governs. Derived server-side from append-only history;
 * never a client-supplied flag.
 */
export function resolvePilotParticipation(events: readonly { eventType: string; payload: string | null; createdAt: Date }[]): Ci7PilotParticipationState {
  const pilotEvents = events
    .filter((e) => e.eventType === 'PILOT_PARTICIPATION_CONSENT' || e.eventType === 'PILOT_PARTICIPATION_WITHDRAWN')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const state: Ci7PilotParticipationState = {
    participant: false,
    latestConsentAt: null,
    latestWithdrawalAt: null,
    protocolVersion: null,
    compensationStatus: null,
  }
  for (const e of pilotEvents) {
    if (e.eventType === 'PILOT_PARTICIPATION_CONSENT') {
      state.participant = true
      state.latestConsentAt = e.createdAt.toISOString()
      state.latestWithdrawalAt = null
      try {
        const payload = JSON.parse(e.payload ?? '{}') as { protocolVersion?: string; compensationStatus?: Ci7PilotCompensationStatus }
        state.protocolVersion = payload.protocolVersion ?? null
        state.compensationStatus = payload.compensationStatus ?? null
      } catch {
        // an unparseable payload must not silently keep stale consent values
        state.protocolVersion = null
        state.compensationStatus = null
      }
    } else {
      state.participant = false
      state.latestWithdrawalAt = e.createdAt.toISOString()
    }
  }
  return state
}

/**
 * The pilot assignment gate. Reused by the EXISTING admin assignment route:
 * an assignment that targets the pilot pack may only be created for a reviewer
 * whose LATEST pilot event is a participation consent for the CURRENT protocol
 * version. Everything else (ACTIVE status, scope, COI, availability,
 * independence) remains the existing createAssignment authority — this gate is
 * purely additive and never relaxes any existing rule.
 */
export function pilotAssignmentGate(
  subjectType: unknown,
  subjectKey: unknown,
  participation: Ci7PilotParticipationState,
): { ok: true } | { ok: false; status: number; error: string } {
  const isPilotSubject = subjectType === 'DOMAIN_PACK' && subjectKey === CI7_PILOT_DOMAIN_ID
  if (!isPilotSubject) return { ok: true }
  if (!participation.participant) {
    return {
      ok: false,
      status: 409,
      error: `the reviewer has not consented to CI-7 pilot participation under ${CI7_PILOT_PROTOCOL_VERSION} (or has withdrawn) — pilot assignments require explicit recorded consent`,
    }
  }
  if (participation.protocolVersion !== CI7_PILOT_PROTOCOL_VERSION) {
    return {
      ok: false,
      status: 409,
      error: `the reviewer's pilot consent names protocol ${participation.protocolVersion ?? 'unknown'}, not the current ${CI7_PILOT_PROTOCOL_VERSION} — re-consent to the current protocol first`,
    }
  }
  return { ok: true }
}
