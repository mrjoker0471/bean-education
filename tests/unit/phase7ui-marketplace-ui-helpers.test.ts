// ─── Phase 7 UI completion: career marketplace UI helpers ────────────────────
// Pure-logic proofs for the helpers behind the marketplace views
// (career-opportunities-view.tsx, career-applications-view.tsx):
//   • deadlineWindowFilter — Any/7/30 map to the real deadlineBefore param
//     (or no param at all) that api.browseOpportunities sends.
//   • deadlineChipState/Label/Class — honest open/closed styling from the
//     listing's real applicationDeadline.
//   • totalPages/clampPage — pagination math from total/pageSize with clamping.
//   • APPLICATION_STATUS_BADGE_CLASS / applicationStatusBadgeClass — every real
//     APPLICATION_STATUS has a treatment; unknowns fall back safely.
//   • filter state — stable serialization, active-chips derivation and the
//     exact browse params mapping (empty strings dropped, deadline windows
//     mapped to deadlineBefore, page/pageSize carried through).
//   • snapshot pipeline — buildApplicationSnapshot includes ONLY explicit
//     selections; previewSnapshotPayload mirrors the apply route's
//     shareContact { email } injection exactly; snapshotDisplayRows renders
//     the student's own snapshot with human labels; consentSummarySections
//     lists the exact shared items (contact only with consent).

import { describe, it, expect } from 'bun:test'
import {
  ACTIVE_WORK_MODES,
  APPLICATION_STATUS_BADGE_CLASS,
  DEADLINE_WINDOW_OPTIONS,
  EMPTY_FILTERS,
  OPPORTUNITIES_PAGE_SIZE,
  activeFilterChips,
  applicationSelectionError,
  applicationStatusBadgeClass,
  applicationStatusLabel,
  browseParams,
  buildApplicationSnapshot,
  canWithdrawApplication,
  clampPage,
  consentSummarySections,
  deadlineChipClass,
  deadlineChipLabel,
  deadlineChipState,
  deadlineWindowFilter,
  employerIsVerified,
  excerpt,
  hasActiveFilters,
  opportunityTypeLabel,
  previewSnapshotPayload,
  serializeOpportunityFilters,
  snapshotDisplayRows,
  totalPages,
  workModeLabel,
} from '@/lib/career-market-ui'

const NOW = new Date('2026-03-10T12:00:00.000Z')
const DAY = 24 * 3600_000

// ─── Deadline window mapping ─────────────────────────────────────────────────

describe('deadlineWindowFilter', () => {
  it('"Any" sends no deadline param (null)', () => {
    expect(deadlineWindowFilter('ANY', NOW)).toBeNull()
  })

  it('"Next 7 days" maps to deadlineBefore = now + 7 days (ISO)', () => {
    expect(deadlineWindowFilter('7', NOW)).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString())
  })

  it('"Next 30 days" maps to deadlineBefore = now + 30 days (ISO)', () => {
    expect(deadlineWindowFilter('30', NOW)).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString())
  })

  it('window choices are exactly Any / 7 / 30', () => {
    expect(DEADLINE_WINDOW_OPTIONS.map(o => o.value)).toEqual(['ANY', '7', '30'])
    expect(DEADLINE_WINDOW_OPTIONS.map(o => o.label)).toEqual(['Any deadline', 'Next 7 days', 'Next 30 days'])
  })

  it('work-mode choices stay within the real free-text values employers type', () => {
    // The route matches with case-insensitive `contains`; employers type
    // "Onsite / Remote / Hybrid" (career-employer-view placeholder).
    expect(ACTIVE_WORK_MODES).toEqual(['ONSITE', 'REMOTE', 'HYBRID'])
  })
})

// ─── Deadline chip state ─────────────────────────────────────────────────────

describe('deadlineChipState', () => {
  it('a missing or unparseable deadline shows no chip', () => {
    expect(deadlineChipState(null, NOW)).toBe('NONE')
    expect(deadlineChipState(undefined, NOW)).toBe('NONE')
    expect(deadlineChipState('', NOW)).toBe('NONE')
    expect(deadlineChipState('not-a-date', NOW)).toBe('NONE')
  })

  it('a passed deadline is CLOSED (exact boundary inclusive)', () => {
    expect(deadlineChipState(new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe('CLOSED')
    expect(deadlineChipState(NOW.toISOString(), NOW)).toBe('CLOSED')
  })

  it('a deadline within the next 7 days is CLOSING_SOON', () => {
    expect(deadlineChipState(new Date(NOW.getTime() + DAY).toISOString(), NOW)).toBe('CLOSING_SOON')
    expect(deadlineChipState(new Date(NOW.getTime() + 7 * DAY).toISOString(), NOW)).toBe('CLOSING_SOON')
  })

  it('a deadline beyond 7 days is OPEN', () => {
    expect(deadlineChipState(new Date(NOW.getTime() + 7 * DAY + 1).toISOString(), NOW)).toBe('OPEN')
    expect(deadlineChipState(new Date(NOW.getTime() + 30 * DAY).toISOString(), NOW)).toBe('OPEN')
  })
})

describe('deadlineChipLabel and deadlineChipClass', () => {
  it('open listings show "closes {date}"', () => {
    const iso = new Date(NOW.getTime() + 10 * DAY).toISOString()
    expect(deadlineChipLabel(iso, NOW)).toBe(`closes ${new Date(iso).toLocaleDateString()}`)
  })

  it('passed listings show exactly "closed"', () => {
    expect(deadlineChipLabel(new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe('closed')
  })

  it('no deadline means no label', () => {
    expect(deadlineChipLabel(null, NOW)).toBeNull()
    expect(deadlineChipLabel('garbage', NOW)).toBeNull()
  })

  it('chip classes differ per state (gold while open, destructive past)', () => {
    expect(deadlineChipClass('OPEN')).toContain('text-gold')
    expect(deadlineChipClass('CLOSING_SOON')).toContain('text-gold')
    expect(deadlineChipClass('OPEN')).not.toBe(deadlineChipClass('CLOSING_SOON'))
    expect(deadlineChipClass('CLOSED')).toContain('text-destructive')
    expect(deadlineChipClass('NONE')).toContain('text-muted-foreground')
  })
})

// ─── Pagination math ─────────────────────────────────────────────────────────

describe('totalPages', () => {
  it('ceil(total/pageSize) for normal values', () => {
    expect(totalPages(0, OPPORTUNITIES_PAGE_SIZE)).toBe(1)
    expect(totalPages(1, 12)).toBe(1)
    expect(totalPages(12, 12)).toBe(1)
    expect(totalPages(13, 12)).toBe(2)
    expect(totalPages(25, 12)).toBe(3)
  })

  it('guards against zero/negative/NaN pageSize and total', () => {
    expect(totalPages(10, 0)).toBe(10)
    expect(totalPages(10, -5)).toBe(10)
    expect(totalPages(10, Number.NaN)).toBe(10)
    expect(totalPages(-3, 12)).toBe(1)
    expect(totalPages(Number.NaN, 12)).toBe(1)
  })
})

describe('clampPage', () => {
  it('keeps valid pages unchanged', () => {
    expect(clampPage(1, 5)).toBe(1)
    expect(clampPage(3, 5)).toBe(3)
    expect(clampPage(5, 5)).toBe(5)
  })

  it('clamps below 1 and above the last page', () => {
    expect(clampPage(0, 5)).toBe(1)
    expect(clampPage(-2, 5)).toBe(1)
    expect(clampPage(6, 5)).toBe(5)
    expect(clampPage(100, 1)).toBe(1)
  })

  it('NaN resolves to page 1', () => {
    expect(clampPage(Number.NaN, 5)).toBe(1)
  })
})

// ─── Application status presentation ─────────────────────────────────────────

describe('application status badge map', () => {
  const ALL_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN']

  it('covers every real APPLICATION_STATUS value', () => {
    for (const status of ALL_STATUSES) {
      expect(APPLICATION_STATUS_BADGE_CLASS[status]).toBeDefined()
      expect(APPLICATION_STATUS_BADGE_CLASS[status].length).toBeGreaterThan(0)
      expect(applicationStatusBadgeClass(status)).toBe(APPLICATION_STATUS_BADGE_CLASS[status])
    }
  })

  it('gives the seven statuses distinct treatments (progress gold → success, terminal red/muted)', () => {
    expect(applicationStatusBadgeClass('SUBMITTED')).toContain('text-gold')
    expect(applicationStatusBadgeClass('UNDER_REVIEW')).toContain('text-gold')
    expect(applicationStatusBadgeClass('SHORTLISTED')).toContain('text-success')
    expect(applicationStatusBadgeClass('INTERVIEW')).toContain('text-success')
    expect(applicationStatusBadgeClass('SELECTED')).toContain('text-success')
    expect(applicationStatusBadgeClass('REJECTED')).toContain('text-destructive')
    expect(applicationStatusBadgeClass('WITHDRAWN')).toContain('text-muted-foreground')
    // Every status maps to its own class string.
    const unique = new Set(ALL_STATUSES.map(s => APPLICATION_STATUS_BADGE_CLASS[s]))
    expect(unique.size).toBe(ALL_STATUSES.length)
  })

  it('unknown statuses fall back to the muted treatment (never unstyled)', () => {
    expect(applicationStatusBadgeClass('MYSTERY_STATUS')).toBe('border-border bg-elevated text-muted-foreground')
  })
})

describe('applicationStatusLabel', () => {
  it('humanizes statuses ("UNDER_REVIEW" → "under review")', () => {
    expect(applicationStatusLabel('SUBMITTED')).toBe('submitted')
    expect(applicationStatusLabel('UNDER_REVIEW')).toBe('under review')
    expect(applicationStatusLabel('WITHDRAWN')).toBe('withdrawn')
  })
})

describe('canWithdrawApplication', () => {
  it('allowed while the application is still in review', () => {
    for (const s of ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW']) expect(canWithdrawApplication(s)).toBe(true)
  })

  it('blocked for terminal and already-withdrawn applications', () => {
    for (const s of ['SELECTED', 'REJECTED', 'WITHDRAWN']) expect(canWithdrawApplication(s)).toBe(false)
    expect(canWithdrawApplication('UNKNOWN')).toBe(false)
  })
})

// ─── Filter state: serialization, chips, browse params ───────────────────────

describe('serializeOpportunityFilters and hasActiveFilters', () => {
  it('serializes with a fixed key order regardless of write order', () => {
    const a = { ...EMPTY_FILTERS, q: 'react', location: 'Kolkata' }
    const b: typeof a = { ...EMPTY_FILTERS, location: 'Kolkata', q: 'react' }
    expect(serializeOpportunityFilters(a)).toBe(serializeOpportunityFilters(b))
    expect(serializeOpportunityFilters(a)).toContain('q=react')
    expect(serializeOpportunityFilters(a)).toContain('location=Kolkata')
  })

  it('empty state serializes to the canonical no-filter string', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(serializeOpportunityFilters(EMPTY_FILTERS)).toBe('q=|type=ALL|workMode=ALL|location=|skill=|employer=|deadline=ANY')
  })

  it('any non-default value counts as an active filter', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: 'x' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, type: 'JOB' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, workMode: 'REMOTE' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, skill: 'Tally' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, employer: 'Acme' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, deadline: '7' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, location: 'Pune' })).toBe(true)
  })

  it('whitespace-only q still counts (trimmed at apply time by the view)', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: '   ' })).toBe(true)
  })
})

describe('activeFilterChips', () => {
  it('produces no chips for the empty filter state', () => {
    expect(activeFilterChips(EMPTY_FILTERS)).toEqual([])
  })

  it('labels every active filter with its human value', () => {
    const chips = activeFilterChips({
      q: 'analyst',
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      location: 'Kolkata',
      skill: 'Tally',
      employer: 'Acme Corp',
      deadline: '7',
    })
    const labels = chips.map(c => c.label)
    expect(labels).toEqual([
      'Search: analyst',
      'Type: Internship',
      'Mode: Hybrid',
      'Location: Kolkata',
      'Skill: Tally',
      'Employer: Acme Corp',
      'Deadline: Next 7 days',
    ])
    expect(chips.map(c => c.key)).toEqual(['q', 'type', 'workMode', 'location', 'skill', 'employer', 'deadline'])
  })
})

describe('browseParams', () => {
  it('drops empty filters and sends page/pageSize', () => {
    expect(browseParams(EMPTY_FILTERS, 1, 12, NOW)).toEqual({ page: 1, pageSize: 12 })
  })

  it('maps every real filter to its api.browseOpportunities param', () => {
    const params = browseParams(
      { q: 'react', type: 'JOB', workMode: 'REMOTE', location: 'Pune', skill: 'Excel', employer: 'Acme', deadline: 'ANY' },
      2,
      12,
      NOW,
    )
    expect(params).toEqual({
      q: 'react',
      type: 'JOB',
      workMode: 'REMOTE',
      location: 'Pune',
      skill: 'Excel',
      employer: 'Acme',
      page: 2,
      pageSize: 12,
    })
    expect(params['deadlineBefore']).toBeUndefined()
  })

  it('maps deadline windows to deadlineBefore ISO timestamps', () => {
    expect(browseParams({ ...EMPTY_FILTERS, deadline: '7' }, 1, 12, NOW)['deadlineBefore']).toBe(
      new Date(NOW.getTime() + 7 * DAY).toISOString(),
    )
    expect(browseParams({ ...EMPTY_FILTERS, deadline: '30' }, 1, 12, NOW)['deadlineBefore']).toBe(
      new Date(NOW.getTime() + 30 * DAY).toISOString(),
    )
    expect(browseParams({ ...EMPTY_FILTERS, deadline: 'ANY' }, 1, 12, NOW)['deadlineBefore']).toBeUndefined()
  })

  it('defaults the page size to the client constant (mirrors the server default)', () => {
    expect(OPPORTUNITIES_PAGE_SIZE).toBe(12)
    expect(browseParams(EMPTY_FILTERS, 3, undefined, NOW)['pageSize']).toBe(12)
  })
})

// ─── Labels and small presentational helpers ─────────────────────────────────

describe('labels and misc helpers', () => {
  it('title-cases opportunity types and work modes', () => {
    expect(opportunityTypeLabel('JOB')).toBe('Job')
    expect(opportunityTypeLabel('INTERNSHIP')).toBe('Internship')
    expect(opportunityTypeLabel('APPRENTICESHIP')).toBe('Apprenticeship')
    expect(opportunityTypeLabel('PROJECT')).toBe('Project')
    expect(workModeLabel('ONSITE')).toBe('Onsite')
    expect(workModeLabel('REMOTE')).toBe('Remote')
    expect(workModeLabel('HYBRID')).toBe('Hybrid')
    expect(opportunityTypeLabel('')).toBe('')
  })

  it('the verified badge appears only for APPROVED organizations', () => {
    expect(employerIsVerified('APPROVED')).toBe(true)
    expect(employerIsVerified('PENDING_REVIEW')).toBe(false)
    expect(employerIsVerified('REJECTED')).toBe(false)
    expect(employerIsVerified('')).toBe(false)
  })

  it('excerpts long descriptions at a word boundary with an ellipsis', () => {
    const short = 'Small role, big learning.'
    expect(excerpt(short, 180)).toBe(short)
    const long = 'word '.repeat(60).trim() // 300 chars
    const cut = excerpt(long, 180)
    expect(cut.length).toBeLessThanOrEqual(181)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.slice(-2, -1)).not.toBe(' ') // no dangling space before the ellipsis
  })
})

// ─── Application snapshot pipeline ───────────────────────────────────────────

const SNAPSHOT_INPUT = {
  includeHeadline: true,
  includeSummary: true,
  note: '  Excited about this role.  ',
  profile: { headline: 'Aspiring analyst', summary: 'I enjoy data work.' },
  skills: [{ skillName: 'Tally', verificationLabel: 'SELF_DECLARED', proficiency: 'ADVANCED' }],
  projects: [{ title: 'GST billing app', description: null, projectUrl: 'https://example.com/p', category: 'PRACTICAL' }],
  credentials: [{ credentialName: 'Accounting basics', issuer: 'Bean Institute', issuedDate: '2026-01-15T00:00:00.000Z' }],
}

describe('buildApplicationSnapshot', () => {
  it('includes exactly the explicitly selected items (and the trimmed note)', () => {
    const snapshot = buildApplicationSnapshot(SNAPSHOT_INPUT)
    expect(Object.keys(snapshot)).toEqual(['headline', 'summary', 'note', 'skills', 'projects', 'credentials'])
    expect(snapshot['headline']).toBe('Aspiring analyst')
    expect(snapshot['summary']).toBe('I enjoy data work.')
    expect(snapshot['note']).toBe('Excited about this role.')
    expect(snapshot['skills']).toEqual([{ skillName: 'Tally', verificationLabel: 'SELF_DECLARED', proficiency: 'ADVANCED' }])
    expect(snapshot['projects']).toEqual([{ title: 'GST billing app', description: null, projectUrl: 'https://example.com/p', category: 'PRACTICAL' }])
    expect(snapshot['credentials']).toEqual([{ credentialName: 'Accounting basics', issuer: 'Bean Institute', issuedDate: '2026-01-15T00:00:00.000Z' }])
  })

  it('excludes unselected profile fields and empty notes', () => {
    const snapshot = buildApplicationSnapshot({ ...SNAPSHOT_INPUT, includeHeadline: false, includeSummary: false, note: '   ' })
    expect(Object.keys(snapshot)).toEqual(['skills', 'projects', 'credentials'])
  })

  it('keeps a null headline when the field was selected but never filled in', () => {
    const snapshot = buildApplicationSnapshot({ ...SNAPSHOT_INPUT, profile: { headline: null, summary: null } })
    expect(snapshot['headline']).toBeNull()
    expect(snapshot['summary']).toBeNull()
  })
})

describe('previewSnapshotPayload', () => {
  const snapshot = buildApplicationSnapshot(SNAPSHOT_INPUT)

  it('consent adds exactly shareContact { email } — mirroring the apply route', () => {
    const payload = previewSnapshotPayload(snapshot, true, 'student@example.com')
    expect(payload['shareContact']).toEqual({ email: 'student@example.com' })
    expect(Object.keys(payload)).toEqual(['headline', 'summary', 'note', 'skills', 'projects', 'credentials', 'shareContact'])
  })

  it('no consent removes any shareContact key', () => {
    const payload = previewSnapshotPayload({ ...snapshot, shareContact: { email: 'stale@example.com' } }, false, 'student@example.com')
    expect(payload['shareContact']).toBeUndefined()
    expect(Object.keys(payload)).not.toContain('shareContact')
  })

  it('falls back to a placeholder when the account email is unavailable', () => {
    const payload = previewSnapshotPayload(snapshot, true, null)
    expect(payload['shareContact']).toEqual({ email: 'your account email' })
  })
})

describe('applicationSelectionError', () => {
  const base = { includeHeadline: false, includeSummary: false, note: '', selectedSkillCount: 0, selectedProjectCount: 0, selectedCredentialCount: 0 }

  it('rejects a completely empty selection (the server would 400)', () => {
    expect(applicationSelectionError(base)).toBe('Select at least one item to share, or add a short note to the employer.')
  })

  it('accepts any single explicit selection', () => {
    expect(applicationSelectionError({ ...base, includeHeadline: true })).toBeNull()
    expect(applicationSelectionError({ ...base, includeSummary: true })).toBeNull()
    expect(applicationSelectionError({ ...base, note: 'hello' })).toBeNull()
    expect(applicationSelectionError({ ...base, selectedSkillCount: 1 })).toBeNull()
    expect(applicationSelectionError({ ...base, selectedProjectCount: 2 })).toBeNull()
    expect(applicationSelectionError({ ...base, selectedCredentialCount: 1 })).toBeNull()
  })
})

describe('consentSummarySections', () => {
  const input = { ...SNAPSHOT_INPUT, shareContact: true, contactEmail: 'student@example.com' }

  it('lists exactly the items that will be shared, including the consented contact', () => {
    const sections = consentSummarySections(input)
    expect(sections.map(s => s.key)).toEqual(['headline', 'summary', 'skills', 'projects', 'credentials', 'note', 'shareContact'])
    const contact = sections.find(s => s.key === 'shareContact')
    expect(contact?.items).toEqual(['Account email — student@example.com'])
    expect(sections.find(s => s.key === 'skills')?.items).toEqual(['Tally (self declared)'])
    expect(sections.find(s => s.key === 'credentials')?.items).toEqual(['Accounting basics — Bean Institute'])
    expect(sections.find(s => s.key === 'note')?.items).toEqual(['Excited about this role.'])
  })

  it('shows the contact section ONLY with consent', () => {
    const withoutConsent = consentSummarySections({ ...input, shareContact: false })
    expect(withoutConsent.map(s => s.key)).not.toContain('shareContact')
  })

  it('flags empty selected profile fields honestly instead of hiding them', () => {
    const sections = consentSummarySections({
      ...input,
      profile: { headline: null, summary: null },
    })
    expect(sections.find(s => s.key === 'headline')?.items).toEqual(['Not set in your profile — shared as empty'])
    expect(sections.find(s => s.key === 'summary')?.items).toEqual(['Not set in your profile — shared as empty'])
  })

  it('omits sections with nothing selected', () => {
    const minimal = consentSummarySections({
      includeHeadline: false,
      includeSummary: false,
      note: '',
      profile: { headline: null, summary: null },
      skills: [],
      projects: [],
      credentials: [],
      shareContact: false,
      contactEmail: null,
    })
    expect(minimal).toEqual([])
  })
})

// ─── Snapshot display (application detail) ───────────────────────────────────

describe('snapshotDisplayRows', () => {
  it('renders text rows with human labels', () => {
    const rows = snapshotDisplayRows({ headline: 'Aspiring analyst', summary: 'I enjoy data work.', note: 'Hello' })
    expect(rows.map(r => `${r.key}:${r.label}`)).toEqual([
      'headline:Headline',
      'summary:Summary',
      'note:Note to the employer',
    ])
    expect(rows.every(r => r.kind === 'text')).toBe(true)
  })

  it('renders list rows with name — extra formatting for skills and credentials', () => {
    const rows = snapshotDisplayRows({
      skills: [
        { skillName: 'Tally', verificationLabel: 'SELF_DECLARED', proficiency: 'ADVANCED' },
        { skillName: 'Excel', verificationLabel: 'SELF_DECLARED', proficiency: null },
      ],
      projects: [{ title: 'GST billing app', description: 'd', projectUrl: 'https://x', category: 'c' }],
      credentials: [{ credentialName: 'Accounting basics', issuer: 'Bean Institute', issuedDate: '2026-01-15' }],
    })
    expect(rows.map(r => r.key)).toEqual(['skills', 'projects', 'credentials'])
    expect(rows.map(r => r.label)).toEqual(['Skills shared', 'Projects shared', 'Credentials shared'])
    expect(rows[0].kind).toBe('list')
    expect(rows[0].items).toEqual(['Tally — ADVANCED', 'Excel'])
    expect(rows[1].items).toEqual(['GST billing app'])
    expect(rows[2].items).toEqual(['Accounting basics — Bean Institute'])
  })

  it('renders the consented contact as an email row', () => {
    const rows = snapshotDisplayRows({ shareContact: { email: 'student@example.com' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('email')
    expect(rows[0].label).toBe('Contact details (consented)')
    expect(rows[0].text).toBe('student@example.com')
  })

  it('renders unknown keys with human fallback (list for arrays, raw JSON for objects)', () => {
    const rows = snapshotDisplayRows({ preferredSkills: ['Tally'] })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('list')
    expect(rows[0].label).toBe('preferredSkills')
    expect(rows[0].items).toEqual(['Tally'])
    const objectRow = snapshotDisplayRows({ customThing: { a: 1 } })
    expect(objectRow).toHaveLength(1)
    expect(objectRow[0].kind).toBe('raw')
    expect(objectRow[0].text).toContain('"a": 1')
  })

  it('follows the canonical key order regardless of object order', () => {
    const rows = snapshotDisplayRows({ skills: [], headline: 'h', note: 'n' })
    expect(rows.map(r => r.key)).toEqual(['headline', 'note', 'skills'])
  })

  it('handles an empty or damaged snapshot with no rows', () => {
    expect(snapshotDisplayRows({})).toEqual([])
  })
})
