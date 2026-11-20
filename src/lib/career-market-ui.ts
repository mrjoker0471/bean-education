// ─── Phase 7 UI completion: career marketplace presentation helpers ──────────
// Pure, client-safe helpers shared by the career marketplace views
// (career-opportunities-view.tsx, career-applications-view.tsx). No React, no
// database, no server-only imports — every function is deterministic and
// unit-tested in tests/unit/phase7ui-marketplace-ui-helpers.test.ts.
//
// Integrity rules these helpers protect:
//   • Deadline windows map to REAL api.browseOpportunities params only
//     (deadlineBefore = today + N days); "Any" sends nothing — the server
//     already excludes past-dated listings from public browse.
//   • Deadline chips are computed from the real applicationDeadline field —
//     a listing is never shown "closed" unless its date has actually passed.
//   • Status badges cover every APPLICATION_STATUS value (plus a safe fallback
//     for unknown future statuses) and never invent a state.
//   • The snapshot preview mirrors the apply route's server-side contact
//     injection exactly: consent adds shareContact { email } and nothing else.

// ─── Deadline window filter (browse) ─────────────────────────────────────────

/**
 * Work-mode filter choices. The API matches with SQLite `contains` (ASCII
 * case-insensitive), so these canonical values match the free-text employers
 * type ("Onsite", "Remote", "Hybrid") regardless of casing.
 */
export const ACTIVE_WORK_MODES: readonly string[] = ['ONSITE', 'REMOTE', 'HYBRID']

/** Deadline window choices for the browse filter bar ("Any" sends no param). */
export type DeadlineWindow = 'ANY' | '7' | '30'

export const DEADLINE_WINDOW_OPTIONS: readonly { value: DeadlineWindow; label: string }[] = [
  { value: 'ANY', label: 'Any deadline' },
  { value: '7', label: 'Next 7 days' },
  { value: '30', label: 'Next 30 days' },
]

/**
 * Map a deadline window choice to the api.browseOpportunities `deadlineBefore`
 * param (an ISO timestamp N days from `now`), or null when "Any" is selected —
 * in which case no deadline param is sent at all. The browse route itself only
 * surfaces future-dated listings, so only a "before" bound is needed.
 */
export function deadlineWindowFilter(window: DeadlineWindow, now: Date = new Date()): string | null {
  const days = window === '7' ? 7 : window === '30' ? 30 : 0
  if (days <= 0) return null
  return new Date(now.getTime() + days * 24 * 3600_000).toISOString()
}

// ─── Deadline chip (cards / detail) ──────────────────────────────────────────

export type DeadlineChipState = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'NONE'

/**
 * Honest chip state from the listing's real applicationDeadline: CLOSED once
 * the date has passed, CLOSING_SOON within the next 7 days, OPEN afterwards
 * and NONE when the listing has no deadline (or an unparseable one).
 */
export function deadlineChipState(deadline: string | null | undefined, now: Date = new Date()): DeadlineChipState {
  if (!deadline) return 'NONE'
  const t = new Date(deadline).getTime()
  if (Number.isNaN(t)) return 'NONE'
  if (t <= now.getTime()) return 'CLOSED'
  if (t - now.getTime() <= 7 * 24 * 3600_000) return 'CLOSING_SOON'
  return 'OPEN'
}

/** "closes {date}" while applications are open, "closed" once the date passed. */
export function deadlineChipLabel(deadline: string | null | undefined, now: Date = new Date()): string | null {
  const state = deadlineChipState(deadline, now)
  if (state === 'NONE') return null
  if (state === 'CLOSED') return 'closed'
  return `closes ${new Date(deadline as string).toLocaleDateString()}`
}

/** Chip styling per deadline state (gold palette while open, destructive past). */
export function deadlineChipClass(state: DeadlineChipState): string {
  switch (state) {
    case 'OPEN': return 'border-gold/40 bg-gold/10 text-gold'
    case 'CLOSING_SOON': return 'border-gold/70 bg-gold/20 text-gold'
    case 'CLOSED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    case 'NONE': return 'border-border bg-elevated text-muted-foreground'
  }
}

// ─── Pagination math ─────────────────────────────────────────────────────────

/** Total pages from a browse response's total/pageSize — never fewer than 1. */
export function totalPages(total: number, pageSize: number): number {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  return Math.max(1, Math.ceil(count / size))
}

/** Clamp a requested page into [1, pages] (NaN and 0/negatives resolve to 1). */
export function clampPage(page: number, pages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(Math.floor(page), Math.max(1, Math.floor(pages)))
}

// ─── Application status presentation ─────────────────────────────────────────

/**
 * Badge treatment per real APPLICATION_STATUS value — covers all seven
 * statuses (SUBMITTED → WITHDRAWN); unknown statuses fall back to the muted
 * treatment instead of rendering unstyled.
 */
export const APPLICATION_STATUS_BADGE_CLASS: Record<string, string> = {
  SUBMITTED: 'border-gold/40 bg-gold/10 text-gold',
  UNDER_REVIEW: 'border-gold/60 bg-gold/15 text-gold',
  SHORTLISTED: 'border-success/40 bg-success/10 text-success',
  INTERVIEW: 'border-success/60 bg-success/15 text-success',
  SELECTED: 'border-success bg-success/20 text-success font-medium',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  WITHDRAWN: 'border-border bg-elevated text-muted-foreground',
}

const FALLBACK_STATUS_BADGE = 'border-border bg-elevated text-muted-foreground'

export function applicationStatusBadgeClass(status: string): string {
  return APPLICATION_STATUS_BADGE_CLASS[status] ?? FALLBACK_STATUS_BADGE
}

/** Human label for an application status ("UNDER_REVIEW" → "under review"). */
export function applicationStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase()
}

/** Withdrawal is possible only while the application is still in review. */
const WITHDRAWABLE_STATUSES: readonly string[] = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW']

export function canWithdrawApplication(status: string): boolean {
  return WITHDRAWABLE_STATUSES.includes(status)
}

// ─── Browse filter state (draft vs applied, chips, serialization) ────────────

export interface OpportunityFilterState {
  q: string
  type: string
  workMode: string
  location: string
  skill: string
  employer: string
  deadline: DeadlineWindow
}

export const EMPTY_FILTERS: OpportunityFilterState = {
  q: '',
  type: 'ALL',
  workMode: 'ALL',
  location: '',
  skill: '',
  employer: '',
  deadline: 'ANY',
}

/** True when at least one filter differs from its "no filter" default. */
export function hasActiveFilters(f: OpportunityFilterState): boolean {
  return serializeOpportunityFilters(f) !== serializeOpportunityFilters(EMPTY_FILTERS)
}

/** Stable serialization (fixed key order) — used to detect real filter changes. */
export function serializeOpportunityFilters(f: OpportunityFilterState): string {
  return ['q', 'type', 'workMode', 'location', 'skill', 'employer', 'deadline']
    .map(k => `${k}=${String(f[k as keyof OpportunityFilterState])}`)
    .join('|')
}

/** Compact human chips for the applied-filter row ("Search", "Type", …). */
export function activeFilterChips(f: OpportunityFilterState): { key: keyof OpportunityFilterState; label: string }[] {
  const chips: { key: keyof OpportunityFilterState; label: string }[] = []
  if (f.q) chips.push({ key: 'q', label: `Search: ${f.q}` })
  if (f.type !== 'ALL') chips.push({ key: 'type', label: `Type: ${opportunityTypeLabel(f.type)}` })
  if (f.workMode !== 'ALL') chips.push({ key: 'workMode', label: `Mode: ${workModeLabel(f.workMode)}` })
  if (f.location) chips.push({ key: 'location', label: `Location: ${f.location}` })
  if (f.skill) chips.push({ key: 'skill', label: `Skill: ${f.skill}` })
  if (f.employer) chips.push({ key: 'employer', label: `Employer: ${f.employer}` })
  if (f.deadline !== 'ANY') {
    const option = DEADLINE_WINDOW_OPTIONS.find(o => o.value === f.deadline)
    chips.push({ key: 'deadline', label: `Deadline: ${option?.label ?? f.deadline}` })
  }
  return chips
}

/** The exact api.browseOpportunities params for an applied filter state + page. */
export interface OpportunityBrowseParams {
  q?: string
  type?: string
  workMode?: string
  location?: string
  skill?: string
  employer?: string
  deadlineBefore?: string
  deadlineAfter?: string
  page?: number
  pageSize?: number
}

/** Client page size — mirrors OPPORTUNITIES_PAGE_SIZE_DEFAULT on the server. */
export const OPPORTUNITIES_PAGE_SIZE = 12

export function browseParams(f: OpportunityFilterState, page: number, pageSize: number = OPPORTUNITIES_PAGE_SIZE, now: Date = new Date()): OpportunityBrowseParams {
  const before = deadlineWindowFilter(f.deadline, now)
  return {
    q: f.q || undefined,
    type: f.type !== 'ALL' ? f.type : undefined,
    workMode: f.workMode !== 'ALL' ? f.workMode : undefined,
    location: f.location || undefined,
    skill: f.skill || undefined,
    employer: f.employer || undefined,
    deadlineBefore: before ?? undefined,
    page,
    pageSize,
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** Title-cased opportunity type ("APPRENTICESHIP" → "Apprenticeship"). */
export function opportunityTypeLabel(type: string): string {
  const words = type.split('_').filter(Boolean)
  if (words.length === 0) return type
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

/** Title-cased work mode ("ONSITE" → "Onsite"); raw value passes through. */
export function workModeLabel(mode: string): string {
  return opportunityTypeLabel(mode)
}

/** The org's identity was reviewed by BEAN — badge only for APPROVED orgs. */
export function employerIsVerified(verificationStatus: string): boolean {
  return verificationStatus === 'APPROVED'
}

/** Word-boundary excerpt for listing cards (2–3 visual lines). */
export function excerpt(text: string, max = 180): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// ─── Application snapshot (consent + preview + display) ──────────────────────

/** Inputs for building the exact application snapshot the client sends. */
export interface SnapshotBuildInput {
  includeHeadline: boolean
  includeSummary: boolean
  note: string
  profile: { headline: string | null; summary: string | null } | null
  skills: { skillName: string; verificationLabel: string; proficiency: string | null }[]
  projects: { title: string; description: string | null; projectUrl: string | null; category: string | null }[]
  credentials: { credentialName: string; issuer: string; issuedDate: string }[]
}

/**
 * Build the snapshot payload exactly as the apply dialog sends it: only
 * explicitly selected items enter the object (a checkbox for headline/summary,
 * explicit skill/project/credential selections, an optional note). The server
 * validates it against isValidApplicationSnapshot's whitelist and injects
 * shareContact ONLY when the separate contactSharingConsent flag is true.
 */
export function buildApplicationSnapshot(input: SnapshotBuildInput): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  if (input.includeHeadline) snapshot['headline'] = input.profile?.headline ?? null
  if (input.includeSummary) snapshot['summary'] = input.profile?.summary ?? null
  if (input.note.trim()) snapshot['note'] = input.note.trim()
  snapshot['skills'] = input.skills
  snapshot['projects'] = input.projects
  snapshot['credentials'] = input.credentials
  return snapshot
}

/**
 * The final payload shape the server will persist: consent adds
 * `shareContact: { email }` (mirroring the apply route's injection) and nothing
 * else. Used for the student-facing preview — it shows the truth of what the
 * employer will receive.
 */
export function previewSnapshotPayload(
  snapshot: Record<string, unknown>,
  contactSharingConsent: boolean,
  email: string | null,
): Record<string, unknown> {
  const out = { ...snapshot }
  if (contactSharingConsent) {
    out['shareContact'] = { email: email ?? 'your account email' }
  } else {
    delete out['shareContact']
  }
  return out
}

/** Guard before "Review snapshot": the server rejects a completely empty snapshot. */
export function applicationSelectionError(input: {
  includeHeadline: boolean
  includeSummary: boolean
  note: string
  selectedSkillCount: number
  selectedProjectCount: number
  selectedCredentialCount: number
}): string | null {
  const hasSomething =
    input.includeHeadline ||
    input.includeSummary ||
    input.note.trim().length > 0 ||
    input.selectedSkillCount > 0 ||
    input.selectedProjectCount > 0 ||
    input.selectedCredentialCount > 0
  return hasSomething ? null : 'Select at least one item to share, or add a short note to the employer.'
}

export interface ConsentSummarySection {
  key: string
  label: string
  items: string[]
}

/**
 * The exact sections/items the employer will receive, for the consent review
 * and the submission confirmation. Contact appears ONLY with consent (and
 * lists the single field the server actually injects: the account email).
 */
export function consentSummarySections(input: SnapshotBuildInput & { shareContact: boolean; contactEmail: string | null }): ConsentSummarySection[] {
  const sections: ConsentSummarySection[] = []
  if (input.includeHeadline) {
    sections.push({ key: 'headline', label: 'Headline', items: [input.profile?.headline || 'Not set in your profile — shared as empty'] })
  }
  if (input.includeSummary) {
    sections.push({ key: 'summary', label: 'Summary', items: [input.profile?.summary || 'Not set in your profile — shared as empty'] })
  }
  if (input.skills.length > 0) {
    sections.push({ key: 'skills', label: 'Skills', items: input.skills.map(s => `${s.skillName} (${s.verificationLabel.replace(/_/g, ' ').toLowerCase()})`) })
  }
  if (input.projects.length > 0) {
    sections.push({ key: 'projects', label: 'Projects', items: input.projects.map(p => p.title) })
  }
  if (input.credentials.length > 0) {
    sections.push({ key: 'credentials', label: 'Credentials', items: input.credentials.map(c => `${c.credentialName} — ${c.issuer}`) })
  }
  if (input.note.trim()) {
    sections.push({ key: 'note', label: 'Note to the employer', items: [input.note.trim()] })
  }
  if (input.shareContact) {
    sections.push({ key: 'shareContact', label: 'Contact details (explicit consent)', items: [`Account email — ${input.contactEmail ?? 'your account email'}`] })
  }
  return sections
}

// ─── Snapshot display (application detail — the student's own record) ────────

export interface SnapshotRow {
  key: string
  label: string
  kind: 'text' | 'list' | 'email' | 'raw'
  text: string
  items: string[]
}

const SNAPSHOT_KEY_ORDER: readonly string[] = ['headline', 'summary', 'note', 'skills', 'projects', 'credentials', 'shareContact']

const SNAPSHOT_KEY_LABELS: Record<string, string> = {
  headline: 'Headline',
  summary: 'Summary',
  note: 'Note to the employer',
  skills: 'Skills shared',
  projects: 'Projects shared',
  credentials: 'Credentials shared',
  shareContact: 'Contact details (consented)',
}

function snapshotItemText(item: unknown): string {
  if (typeof item === 'string') return item
  if (typeof item === 'object' && item !== null) {
    const o = item as Record<string, unknown>
    const name = o['skillName'] ?? o['credentialName'] ?? o['title']
    if (typeof name === 'string' && name) {
      const extra = o['proficiency'] ?? o['issuer']
      return typeof extra === 'string' && extra ? `${name} — ${extra}` : name
    }
  }
  try {
    return JSON.stringify(item)
  } catch {
    return String(item)
  }
}

/**
 * Render rows for the student's own submission-time snapshot. Known keys map
 * to human labels; unknown keys (future snapshot additions) degrade to a raw
 * JSON row instead of being hidden — the student always sees the whole record.
 */
export function snapshotDisplayRows(snapshot: Record<string, unknown>): SnapshotRow[] {
  const keys = [...SNAPSHOT_KEY_ORDER.filter(k => k in snapshot), ...Object.keys(snapshot).filter(k => !SNAPSHOT_KEY_ORDER.includes(k))]
  const rows: SnapshotRow[] = []
  for (const key of keys) {
    const value = snapshot[key]
    const base = { key, label: SNAPSHOT_KEY_LABELS[key] ?? key }
    if (key === 'shareContact' && typeof value === 'object' && value !== null) {
      const email = (value as Record<string, unknown>)['email']
      rows.push({ ...base, kind: 'email', text: typeof email === 'string' ? email : JSON.stringify(value), items: [] })
      continue
    }
    if (typeof value === 'string') {
      rows.push({ ...base, kind: 'text', text: value, items: [] })
      continue
    }
    if (Array.isArray(value)) {
      rows.push({ ...base, kind: 'list', text: '', items: value.map(snapshotItemText) })
      continue
    }
    try {
      rows.push({ ...base, kind: 'raw', text: JSON.stringify(value, null, 2), items: [] })
    } catch {
      rows.push({ ...base, kind: 'raw', text: String(value), items: [] })
    }
  }
  return rows
}
