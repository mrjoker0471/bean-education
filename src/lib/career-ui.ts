// ─── Phase 7 UI completion: career dashboard presentation helpers ────────────
// Pure, client-safe helpers shared by the student career views
// (career-view.tsx, career-profile-view.tsx, career-portfolio-view.tsx).
// No React, no database, no server-only imports — every function is
// deterministic and unit-tested in tests/unit/phase7ui-career-ui-helpers.test.ts.
//
// Integrity rules these helpers protect:
//   • Employer-discovery eligibility derives ONLY from the real visibility
//     choice and the real adult-eligibility review status — the server, not
//     the UI, enforces the gate, and these strings never promise discovery
//     before APPROVED.
//   • Recommended next actions come from actual profile/portfolio state. A
//     section whose data is unknown (null — not loaded, or failed to load)
//     never produces a recommendation, so the dashboard never guesses.
//   • No scores, ranks or ratings are synthesized anywhere — counts aggregate
//     real API rows only.

export type CareerVisibility = 'PRIVATE' | 'DISCOVERABLE' | 'PAUSED'
export type CareerEligibilityStatus = 'NOT_ELIGIBLE' | 'PENDING_REVIEW' | 'APPROVED' | 'DENIED'

/** Title-case fallback so a new server enum value never renders as SCREAMING_SNAKE. */
function humanizeFallback(value: string): string {
  const words = value.split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  return words.length > 0 ? words.join(' ') : value
}

// ─── Visibility ──────────────────────────────────────────────────────────────

export function visibilityHumanLabel(visibility: string): string {
  switch (visibility) {
    case 'PRIVATE': return 'Private'
    case 'DISCOVERABLE': return 'Discoverable'
    case 'PAUSED': return 'Paused'
    default: return humanizeFallback(visibility)
  }
}

export function visibilityBadgeClass(visibility: string): string {
  switch (visibility) {
    case 'DISCOVERABLE': return 'border-gold/40 bg-gold/10 text-gold'
    case 'PAUSED': return 'border-dashed border-border bg-elevated text-muted-foreground'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

/** The per-option description shown in the profile editor next to the Select. */
export function visibilityDescription(visibility: string): string {
  switch (visibility) {
    case 'PRIVATE': return 'Only you can see this profile'
    case 'DISCOVERABLE': return 'Verified employers can discover you after eligibility approval'
    case 'PAUSED': return 'Hidden from discovery; data kept'
    default: return ''
  }
}

// ─── Adult eligibility (safeguarding) ────────────────────────────────────────

export function eligibilityHumanLabel(status: string): string {
  switch (status) {
    case 'APPROVED': return 'Eligibility approved'
    case 'PENDING_REVIEW': return 'Review pending'
    case 'DENIED': return 'Review denied'
    case 'NOT_ELIGIBLE': return 'Not reviewed yet'
    default: return humanizeFallback(status)
  }
}

export function eligibilityBadgeClass(status: string): string {
  switch (status) {
    case 'APPROVED': return 'border-success/40 bg-success/10 text-success'
    case 'PENDING_REVIEW': return 'border-gold/40 bg-gold/10 text-gold'
    case 'DENIED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

export type DiscoveryTone = 'eligible' | 'blocked' | 'off'

export interface DiscoveryEligibility {
  /** The exact status line rendered under the badges. */
  line: string
  tone: DiscoveryTone
}

/**
 * The single source of truth for the employer-discovery status line. Derived
 * from the real visibility choice and the real review status only:
 *   DISCOVERABLE + APPROVED        → eligible for employer discovery
 *   DISCOVERABLE + anything else   → discovery requires the approved review
 *   anything else                  → not listed (profile is private/paused)
 */
export function discoveryEligibility(visibility: string, eligibilityStatus: string): DiscoveryEligibility {
  if (visibility === 'DISCOVERABLE') {
    if (eligibilityStatus === 'APPROVED') {
      return { line: 'Eligible for employer discovery', tone: 'eligible' }
    }
    return { line: 'Discovery requires approved adult-eligibility review', tone: 'blocked' }
  }
  return { line: 'Not listed — profile is private/paused', tone: 'off' }
}

export function discoveryToneClass(tone: DiscoveryTone): string {
  switch (tone) {
    case 'eligible': return 'text-success'
    case 'blocked': return 'text-gold'
    default: return 'text-muted-foreground'
  }
}

// ─── Counts (real rows only) ─────────────────────────────────────────────────

export interface CareerCountSources {
  skills: readonly { verificationLabel: string }[] | null
  projects: readonly { visibility: string }[] | null
  credentials: readonly { portfolioShared: boolean }[] | null
  applications: readonly unknown[] | null
}

export interface CareerCounts {
  skills: number | null
  skillsVerified: number | null
  projects: number | null
  projectsShared: number | null
  credentials: number | null
  credentialsShared: number | null
  applications: number | null
}

/**
 * Aggregate the dashboard counts from real API rows. A null source (section
 * not loaded or failed) stays null — the UI renders "—" instead of a fake 0.
 * "Verified" skills are those carrying INSTITUTION_ISSUED or
 * BEAN_ASSESSMENT_VERIFIED labels; self-declared never counts as verified.
 */
export function careerCounts(sources: CareerCountSources): CareerCounts {
  const count = <T,>(rows: readonly T[] | null): number | null => (rows === null ? null : rows.length)
  return {
    skills: count(sources.skills),
    skillsVerified: sources.skills === null
      ? null
      : sources.skills.filter(s => s.verificationLabel === 'INSTITUTION_ISSUED' || s.verificationLabel === 'BEAN_ASSESSMENT_VERIFIED').length,
    projects: count(sources.projects),
    projectsShared: sources.projects === null
      ? null
      : sources.projects.filter(p => p.visibility === 'SHARED').length,
    credentials: count(sources.credentials),
    credentialsShared: sources.credentials === null
      ? null
      : sources.credentials.filter(c => c.portfolioShared).length,
    applications: count(sources.applications),
  }
}

// ─── Applications by status ──────────────────────────────────────────────────

/** Canonical display order; unknown server statuses append after these. */
const APPLICATION_STATUS_ORDER = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN'] as const

export function applicationStatusLabel(status: string): string {
  switch (status) {
    case 'SUBMITTED': return 'Submitted'
    case 'UNDER_REVIEW': return 'Under review'
    case 'SHORTLISTED': return 'Shortlisted'
    case 'INTERVIEW': return 'Interview'
    case 'SELECTED': return 'Selected'
    case 'REJECTED': return 'Rejected'
    case 'WITHDRAWN': return 'Withdrawn'
    default: return humanizeFallback(status)
  }
}

export function applicationStatusBadgeClass(status: string): string {
  switch (status) {
    case 'SUBMITTED':
    case 'UNDER_REVIEW': return 'border-gold/40 bg-gold/10 text-gold'
    case 'SHORTLISTED':
    case 'INTERVIEW':
    case 'SELECTED': return 'border-success/40 bg-success/10 text-success'
    case 'REJECTED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    case 'WITHDRAWN': return 'border-border bg-elevated text-muted-foreground'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

export interface ApplicationStatusChip {
  status: string
  count: number
  label: string
  badgeClass: string
}

/**
 * Group real applications by status, canonical order first, unknown statuses
 * appended, and only statuses with at least one application are returned.
 */
export function applicationStatusChips(applications: readonly { status: string }[] | null): ApplicationStatusChip[] {
  if (applications === null) return []
  const counts = new Map<string, number>()
  for (const a of applications) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
  const ordered = [
    ...APPLICATION_STATUS_ORDER.filter(s => counts.has(s)),
    ...[...counts.keys()].filter(s => !APPLICATION_STATUS_ORDER.includes(s as (typeof APPLICATION_STATUS_ORDER)[number])),
  ]
  return ordered.map(status => ({
    status,
    count: counts.get(status) ?? 0,
    label: applicationStatusLabel(status),
    badgeClass: applicationStatusBadgeClass(status),
  }))
}

// ─── Recommended next actions (pure derived logic) ───────────────────────────

export type CareerActionTarget = 'career-profile' | 'career-portfolio' | 'career-opportunities' | 'career-applications'

export interface NextCareerAction {
  id: string
  label: string
  description: string
  target: CareerActionTarget
}

export interface NextCareerActionInput {
  /** null = not loaded / failed to load — rules that need it are skipped. */
  profile: { headline: string | null; visibility: string } | null
  eligibility: { status: string } | null
  skills: readonly unknown[] | null
  projects: readonly unknown[] | null
  credentials: readonly { status: string; portfolioShared: boolean }[] | null
}

/**
 * Honest, data-derived next steps, in fixed priority order, capped at 3.
 * Every rule checks REAL state; unknown (null) sections are skipped rather
 * than guessed. No scores or ranks are invented — ever.
 */
export function nextCareerActions(input: NextCareerActionInput): NextCareerAction[] {
  const actions: NextCareerAction[] = []

  if (input.profile && !input.profile.headline) {
    actions.push({ id: 'add-headline', label: 'Add a headline', description: 'One line that says what you are aiming for.', target: 'career-profile' })
  }
  if (input.skills !== null && input.skills.length === 0) {
    actions.push({ id: 'add-first-skill', label: 'Add your first skill', description: 'Self-declared to start — institutions can issue verified ones.', target: 'career-portfolio' })
  }
  if (input.eligibility && input.eligibility.status === 'NOT_ELIGIBLE') {
    actions.push({ id: 'request-review', label: 'Request adult-eligibility review', description: 'BEAN administrators approve discovery and applications.', target: 'career-profile' })
  }
  if (input.projects !== null && input.projects.length === 0) {
    actions.push({ id: 'add-project', label: 'Add a project', description: 'Academic work, personal builds, internships or research.', target: 'career-portfolio' })
  }
  if (input.credentials !== null && input.credentials.some(c => c.status === 'ISSUED' && !c.portfolioShared)) {
    actions.push({ id: 'share-credential', label: 'Share a credential to your portfolio', description: 'An issued credential you have not shared yet.', target: 'career-portfolio' })
  }
  if (input.profile && input.profile.visibility === 'PRIVATE' && input.eligibility && input.eligibility.status === 'APPROVED') {
    actions.push({ id: 'enable-discovery', label: 'Consider enabling discovery', description: 'Your eligibility is approved — discovery stays off while the profile is private.', target: 'career-profile' })
  }

  return actions.slice(0, 3)
}

// ─── Skill verification labels (honest) ──────────────────────────────────────

export function skillVerificationLabel(label: string): string {
  switch (label) {
    case 'SELF_DECLARED': return 'Self-declared'
    case 'INSTITUTION_ISSUED': return 'Institution issued'
    case 'BEAN_ASSESSMENT_VERIFIED': return 'BEAN assessment verified'
    default: return humanizeFallback(label)
  }
}

export function skillVerificationBadgeClass(label: string): string {
  switch (label) {
    case 'INSTITUTION_ISSUED': return 'border-gold/40 bg-gold/10 text-gold'
    case 'BEAN_ASSESSMENT_VERIFIED': return 'border-success/40 bg-success/10 text-success'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

/** True when at least one skill exists and every one of them is SELF_DECLARED. */
export function allSkillsSelfDeclared(skills: readonly { verificationLabel: string }[]): boolean {
  return skills.length > 0 && skills.every(s => s.verificationLabel === 'SELF_DECLARED')
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function projectCategoryLabel(category: string | null): string | null {
  if (!category) return null
  switch (category) {
    case 'ACADEMIC': return 'Academic'
    case 'PERSONAL': return 'Personal'
    case 'PRACTICAL': return 'Practical exercise'
    case 'INTERNSHIP': return 'Internship'
    case 'RESEARCH': return 'Research'
    case 'SKILL_DEMO': return 'Skill demonstration'
    default: return humanizeFallback(category)
  }
}

export function projectCategoryBadgeClass(): string {
  return 'border-gold/40 bg-gold/10 text-gold'
}

/** Neutral badge class for the ARCHIVED marker (active projects show no badge). */
export function projectArchivedBadgeClass(): string {
  return 'border-border bg-elevated text-muted-foreground'
}

// ─── Profile editor dirty-state check ────────────────────────────────────────

export interface CareerProfileFormValues {
  headline: string
  summary: string
  preferredRoleTypes: string
  preferredSkills: string
  preferredLocations: string
  workModes: string
  visibility: string
  publicSlug: string
}

/**
 * True when the editor differs from the last server-confirmed values.
 * List fields compare as trimmed item sets (extra spaces around commas are
 * not a real change); headline/summary compare trimmed; visibility exact.
 */
export function careerProfileIsDirty(current: CareerProfileFormValues, saved: CareerProfileFormValues | null): boolean {
  if (!saved) return false
  const normalizeList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean).join(', ')
  return (
    current.headline.trim() !== saved.headline.trim() ||
    current.summary.trim() !== saved.summary.trim() ||
    normalizeList(current.preferredRoleTypes) !== normalizeList(saved.preferredRoleTypes) ||
    normalizeList(current.preferredSkills) !== normalizeList(saved.preferredSkills) ||
    normalizeList(current.preferredLocations) !== normalizeList(saved.preferredLocations) ||
    normalizeList(current.workModes) !== normalizeList(saved.workModes) ||
    current.visibility !== saved.visibility ||
    current.publicSlug.trim() !== saved.publicSlug.trim()
  )
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/** Local date string, or null when missing/invalid — never "Invalid Date". */
export function formatCareerDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : new Date(t).toLocaleDateString()
}
