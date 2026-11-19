// ─── Phase 7 UI completion: career dashboard presentation helpers ────────────
// Pure unit tests for src/lib/career-ui.ts — the helpers behind the student
// career hub dashboard, profile editor and portfolio:
//   • nextCareerActions: every rule triggers on its exact real-state condition,
//     is excluded otherwise, respects the fixed priority order and the cap of
//     3, and never guesses from unknown (null) sections.
//   • discoveryEligibility: the full visibility x eligibility matrix —
//     employer discovery is only ever "eligible" for DISCOVERABLE + APPROVED.
//   • careerCounts: aggregation over real rows; null sources stay null.
//   • applicationStatusChips: canonical order, n>0 only, unknown appended.
//   • Honest labels (visibility, eligibility, skill verification, categories),
//     the dirty-state comparison, and safe date formatting.

import { describe, it, expect } from 'bun:test'
import {
  allSkillsSelfDeclared, applicationStatusChips, applicationStatusBadgeClass,
  applicationStatusLabel, careerCounts, careerProfileIsDirty, discoveryEligibility,
  eligibilityBadgeClass, eligibilityHumanLabel, formatCareerDate, nextCareerActions,
  projectCategoryLabel, skillVerificationBadgeClass, skillVerificationLabel,
  visibilityBadgeClass, visibilityDescription, visibilityHumanLabel,
} from '@/lib/career-ui'

// ─── nextCareerActions ───────────────────────────────────────────────────────

describe('nextCareerActions', () => {
  // Table: [ruleId, minimal real-state input that must trigger exactly this rule]
  const RULE_TRIGGERS: {
    id: string
    label: string
    input: Parameters<typeof nextCareerActions>[0]
  }[] = [
    {
      id: 'add-headline',
      label: 'Add a headline',
      input: { profile: { headline: null, visibility: 'PRIVATE' }, eligibility: null, skills: [], projects: [], credentials: [] },
    },
    {
      id: 'add-first-skill',
      label: 'Add your first skill',
      input: { profile: { headline: 'CA aspirant', visibility: 'PRIVATE' }, eligibility: null, skills: [], projects: [], credentials: [] },
    },
    {
      id: 'request-review',
      label: 'Request adult-eligibility review',
      input: { profile: { headline: 'CA aspirant', visibility: 'PRIVATE' }, eligibility: { status: 'NOT_ELIGIBLE' }, skills: [{ id: 's1' }], projects: [{ id: 'p1' }], credentials: [] },
    },
    {
      id: 'add-project',
      label: 'Add a project',
      input: { profile: { headline: 'CA aspirant', visibility: 'PRIVATE' }, eligibility: { status: 'APPROVED' }, skills: [{ id: 's1' }], projects: [], credentials: [] },
    },
    {
      id: 'share-credential',
      label: 'Share a credential to your portfolio',
      input: {
        profile: { headline: 'CA aspirant', visibility: 'PRIVATE' },
        eligibility: { status: 'APPROVED' },
        skills: [{ id: 's1' }],
        projects: [{ id: 'p1' }],
        credentials: [{ status: 'ISSUED', portfolioShared: false }],
      },
    },
    {
      id: 'enable-discovery',
      label: 'Consider enabling discovery',
      input: { profile: { headline: 'CA aspirant', visibility: 'PRIVATE' }, eligibility: { status: 'APPROVED' }, skills: [{ id: 's1' }], projects: [{ id: 'p1' }], credentials: [] },
    },
  ]

  it('triggers each rule exactly when its real-state condition holds', () => {
    for (const rule of RULE_TRIGGERS) {
      const actions = nextCareerActions(rule.input)
      // request-review and enable-discovery both key off eligibility/visibility
      // combos that never co-trigger, so each table row yields exactly one hit.
      expect(actions.some(a => a.id === rule.id)).toBe(true)
      expect(actions.find(a => a.id === rule.id)?.label).toBe(rule.label)
    }
  })

  it('excludes each rule when its condition is violated', () => {
    // headline present -> no add-headline
    expect(nextCareerActions({ profile: { headline: 'H', visibility: 'PRIVATE' }, eligibility: null, skills: null, projects: null, credentials: null }).some(a => a.id === 'add-headline')).toBe(false)
    // skills non-empty -> no add-first-skill
    expect(nextCareerActions({ profile: null, eligibility: null, skills: [{ id: 's1' }], projects: null, credentials: null }).some(a => a.id === 'add-first-skill')).toBe(false)
    // eligibility APPROVED -> no request-review
    expect(nextCareerActions({ profile: null, eligibility: { status: 'APPROVED' }, skills: null, projects: null, credentials: null }).some(a => a.id === 'request-review')).toBe(false)
    // eligibility PENDING_REVIEW -> no request-review either
    expect(nextCareerActions({ profile: null, eligibility: { status: 'PENDING_REVIEW' }, skills: null, projects: null, credentials: null }).some(a => a.id === 'request-review')).toBe(false)
    // projects non-empty -> no add-project
    expect(nextCareerActions({ profile: null, eligibility: null, skills: null, projects: [{ id: 'p1' }], credentials: null }).some(a => a.id === 'add-project')).toBe(false)
    // all credentials shared -> no share-credential
    expect(nextCareerActions({ profile: null, eligibility: null, skills: null, projects: null, credentials: [{ status: 'ISSUED', portfolioShared: true }] }).some(a => a.id === 'share-credential')).toBe(false)
    // revoked credential is not recommendable for sharing
    expect(nextCareerActions({ profile: null, eligibility: null, skills: null, projects: null, credentials: [{ status: 'REVOKED', portfolioShared: false }] }).some(a => a.id === 'share-credential')).toBe(false)
    // visibility DISCOVERABLE -> no enable-discovery (it is already on)
    expect(nextCareerActions({ profile: { headline: 'H', visibility: 'DISCOVERABLE' }, eligibility: { status: 'APPROVED' }, skills: null, projects: null, credentials: null }).some(a => a.id === 'enable-discovery')).toBe(false)
    // PRIVATE but eligibility not APPROVED -> no enable-discovery (honest)
    expect(nextCareerActions({ profile: { headline: 'H', visibility: 'PRIVATE' }, eligibility: { status: 'NOT_ELIGIBLE' }, skills: null, projects: null, credentials: null }).some(a => a.id === 'enable-discovery')).toBe(false)
  })

  it('skips rules whose section is unknown (null) instead of guessing', () => {
    const actions = nextCareerActions({ profile: null, eligibility: null, skills: null, projects: null, credentials: null })
    expect(actions).toEqual([])
  })

  it('caps at 3 actions following the fixed priority order', () => {
    const actions = nextCareerActions({
      profile: { headline: null, visibility: 'PRIVATE' },
      eligibility: { status: 'NOT_ELIGIBLE' },
      skills: [],
      projects: [],
      credentials: [{ status: 'ISSUED', portfolioShared: false }],
    })
    expect(actions.map(a => a.id)).toEqual(['add-headline', 'add-first-skill', 'request-review'])
  })

  it('keeps the documented rule priority when fewer than 3 apply', () => {
    const actions = nextCareerActions({
      profile: { headline: 'H', visibility: 'PRIVATE' },
      eligibility: { status: 'APPROVED' },
      skills: [],
      projects: [],
      credentials: [],
    })
    expect(actions.map(a => a.id)).toEqual(['add-first-skill', 'add-project', 'enable-discovery'])
  })

  it('every action targets a real career route view', () => {
    const targets = new Set(['career-profile', 'career-portfolio', 'career-opportunities', 'career-applications'])
    const actions = nextCareerActions({
      profile: { headline: null, visibility: 'PRIVATE' },
      eligibility: { status: 'NOT_ELIGIBLE' },
      skills: [],
      projects: [],
      credentials: [{ status: 'ISSUED', portfolioShared: false }],
    })
    expect(actions.length).toBeGreaterThan(0)
    for (const a of actions) expect(targets.has(a.target)).toBe(true)
  })
})

// ─── discoveryEligibility: full visibility x eligibility matrix ──────────────

describe('discoveryEligibility', () => {
  const VISIBILITIES = ['PRIVATE', 'DISCOVERABLE', 'PAUSED'] as const
  const ELIGIBILITIES = ['NOT_ELIGIBLE', 'PENDING_REVIEW', 'APPROVED', 'DENIED'] as const

  const EXPECTED: Record<string, { line: string; tone: string }> = {
    'DISCOVERABLE|APPROVED': { line: 'Eligible for employer discovery', tone: 'eligible' },
    'DISCOVERABLE|NOT_ELIGIBLE': { line: 'Discovery requires approved adult-eligibility review', tone: 'blocked' },
    'DISCOVERABLE|PENDING_REVIEW': { line: 'Discovery requires approved adult-eligibility review', tone: 'blocked' },
    'DISCOVERABLE|DENIED': { line: 'Discovery requires approved adult-eligibility review', tone: 'blocked' },
  }

  it('derives the correct line and tone for every visibility x eligibility combination', () => {
    for (const visibility of VISIBILITIES) {
      for (const status of ELIGIBILITIES) {
        const result = discoveryEligibility(visibility, status)
        const key = `${visibility}|${status}`
        const expected = EXPECTED[key] ?? { line: 'Not listed — profile is private/paused', tone: 'off' }
        expect(result.line).toBe(expected.line)
        expect(result.tone).toBe(expected.tone)
      }
    }
  })

  it('treats an unknown visibility as not listed (never discoverable by accident)', () => {
    expect(discoveryEligibility('WEIRD_VALUE', 'APPROVED').tone).toBe('off')
    expect(discoveryEligibility('WEIRD_VALUE', 'APPROVED').line).toBe('Not listed — profile is private/paused')
    expect(discoveryEligibility('', 'APPROVED').tone).toBe('off')
  })
})

// ─── careerCounts ────────────────────────────────────────────────────────────

describe('careerCounts', () => {
  it('aggregates real rows: totals, shared and verified counts', () => {
    const counts = careerCounts({
      skills: [
        { verificationLabel: 'SELF_DECLARED' },
        { verificationLabel: 'INSTITUTION_ISSUED' },
        { verificationLabel: 'BEAN_ASSESSMENT_VERIFIED' },
      ],
      projects: [
        { visibility: 'SHARED' },
        { visibility: 'PRIVATE' },
        { visibility: 'SHARED' },
      ],
      credentials: [
        { portfolioShared: true },
        { portfolioShared: false },
      ],
      applications: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
    })
    expect(counts.skills).toBe(3)
    expect(counts.skillsVerified).toBe(2) // SELF_DECLARED never counts as verified
    expect(counts.projects).toBe(3)
    expect(counts.projectsShared).toBe(2)
    expect(counts.credentials).toBe(2)
    expect(counts.credentialsShared).toBe(1)
    expect(counts.applications).toBe(3)
  })

  it('reports zero honestly for empty sections', () => {
    const counts = careerCounts({ skills: [], projects: [], credentials: [], applications: [] })
    expect(counts.skills).toBe(0)
    expect(counts.skillsVerified).toBe(0)
    expect(counts.projects).toBe(0)
    expect(counts.projectsShared).toBe(0)
    expect(counts.credentials).toBe(0)
    expect(counts.credentialsShared).toBe(0)
    expect(counts.applications).toBe(0)
  })

  it('keeps a null source null (section failed/unknown) instead of faking 0', () => {
    const counts = careerCounts({ skills: null, projects: [{ visibility: 'SHARED' }], credentials: null, applications: null })
    expect(counts.skills).toBeNull()
    expect(counts.skillsVerified).toBeNull()
    expect(counts.projects).toBe(1)
    expect(counts.projectsShared).toBe(1)
    expect(counts.credentials).toBeNull()
    expect(counts.credentialsShared).toBeNull()
    expect(counts.applications).toBeNull()
  })
})

// ─── applicationStatusChips ──────────────────────────────────────────────────

describe('applicationStatusChips', () => {
  it('groups real applications in canonical order, n>0 only', () => {
    const chips = applicationStatusChips([
      { status: 'UNDER_REVIEW' },
      { status: 'SUBMITTED' },
      { status: 'UNDER_REVIEW' },
      { status: 'REJECTED' },
    ])
    expect(chips.map(c => `${c.status}:${c.count}`)).toEqual(['SUBMITTED:1', 'UNDER_REVIEW:2', 'REJECTED:1'])
    expect(chips[0].label).toBe('Submitted')
    expect(chips[1].label).toBe('Under review')
  })

  it('appends unknown server statuses after the canonical ones', () => {
    const chips = applicationStatusChips([{ status: 'SOMETHING_NEW' }, { status: 'SUBMITTED' }])
    expect(chips.map(c => c.status)).toEqual(['SUBMITTED', 'SOMETHING_NEW'])
    expect(chips[1].label).toBe('Something New')
    expect(chips[1].badgeClass).toContain('text-muted-foreground')
  })

  it('omits statuses with zero applications', () => {
    const chips = applicationStatusChips([{ status: 'WITHDRAWN' }])
    expect(chips.map(c => c.status)).toEqual(['WITHDRAWN'])
    expect(chips.some(c => c.status === 'SUBMITTED')).toBe(false)
  })

  it('returns nothing for empty or unknown data', () => {
    expect(applicationStatusChips([])).toEqual([])
    expect(applicationStatusChips(null)).toEqual([])
  })

  it('labels and badge tones cover every known status', () => {
    expect(applicationStatusLabel('INTERVIEW')).toBe('Interview')
    expect(applicationStatusLabel('SHORTLISTED')).toBe('Shortlisted')
    expect(applicationStatusLabel('SELECTED')).toBe('Selected')
    expect(applicationStatusBadgeClass('SELECTED')).toContain('text-success')
    expect(applicationStatusBadgeClass('REJECTED')).toContain('text-destructive')
    expect(applicationStatusBadgeClass('WITHDRAWN')).toContain('text-muted-foreground')
    expect(applicationStatusBadgeClass('SUBMITTED')).toContain('text-gold')
  })
})

// ─── Honest labels ───────────────────────────────────────────────────────────

describe('honest labels', () => {
  it('visibility descriptions match the copy required by the profile editor', () => {
    expect(visibilityDescription('PRIVATE')).toBe('Only you can see this profile')
    expect(visibilityDescription('DISCOVERABLE')).toBe('Verified employers can discover you after eligibility approval')
    expect(visibilityDescription('PAUSED')).toBe('Hidden from discovery; data kept')
  })

  it('visibility labels and badges give each state a distinct presentation', () => {
    expect(visibilityHumanLabel('PRIVATE')).toBe('Private')
    expect(visibilityHumanLabel('DISCOVERABLE')).toBe('Discoverable')
    expect(visibilityHumanLabel('PAUSED')).toBe('Paused')
    expect(visibilityBadgeClass('DISCOVERABLE')).toContain('text-gold')
    expect(visibilityBadgeClass('PAUSED')).toContain('border-dashed')
    expect(visibilityBadgeClass('PRIVATE')).toContain('text-muted-foreground')
  })

  it('eligibility labels are human and safe for unknown server values', () => {
    expect(eligibilityHumanLabel('APPROVED')).toBe('Eligibility approved')
    expect(eligibilityHumanLabel('PENDING_REVIEW')).toBe('Review pending')
    expect(eligibilityHumanLabel('DENIED')).toBe('Review denied')
    expect(eligibilityHumanLabel('NOT_ELIGIBLE')).toBe('Not reviewed yet')
    expect(eligibilityHumanLabel('FUTURE_STATE')).toBe('Future State')
    expect(eligibilityBadgeClass('APPROVED')).toContain('text-success')
    expect(eligibilityBadgeClass('DENIED')).toContain('text-destructive')
  })

  it('skill verification labels never overstate a self-declared skill', () => {
    expect(skillVerificationLabel('SELF_DECLARED')).toBe('Self-declared')
    expect(skillVerificationLabel('INSTITUTION_ISSUED')).toBe('Institution issued')
    expect(skillVerificationLabel('BEAN_ASSESSMENT_VERIFIED')).toBe('BEAN assessment verified')
    expect(skillVerificationBadgeClass('SELF_DECLARED')).toContain('text-muted-foreground')
    expect(skillVerificationBadgeClass('INSTITUTION_ISSUED')).toContain('text-gold')
    expect(skillVerificationBadgeClass('BEAN_ASSESSMENT_VERIFIED')).toContain('text-success')
  })

  it('allSkillsSelfDeclared is true only when every skill is SELF_DECLARED', () => {
    expect(allSkillsSelfDeclared([])).toBe(false)
    expect(allSkillsSelfDeclared([{ verificationLabel: 'SELF_DECLARED' }])).toBe(true)
    expect(allSkillsSelfDeclared([{ verificationLabel: 'SELF_DECLARED' }, { verificationLabel: 'INSTITUTION_ISSUED' }])).toBe(false)
  })

  it('project category labels cover every enum value and pass null through', () => {
    expect(projectCategoryLabel('ACADEMIC')).toBe('Academic')
    expect(projectCategoryLabel('PERSONAL')).toBe('Personal')
    expect(projectCategoryLabel('PRACTICAL')).toBe('Practical exercise')
    expect(projectCategoryLabel('INTERNSHIP')).toBe('Internship')
    expect(projectCategoryLabel('RESEARCH')).toBe('Research')
    expect(projectCategoryLabel('SKILL_DEMO')).toBe('Skill demonstration')
    expect(projectCategoryLabel('NEW_KIND')).toBe('New Kind')
    expect(projectCategoryLabel(null)).toBeNull()
  })
})

// ─── Dirty-state comparison (profile editor) ─────────────────────────────────

describe('careerProfileIsDirty', () => {
  const saved = {
    headline: 'CA aspirant',
    summary: 'Studying commerce.',
    preferredRoleTypes: 'Accounting, Audit',
    preferredSkills: 'Tally, Excel',
    preferredLocations: 'Kolkata',
    workModes: 'Hybrid',
    visibility: 'PRIVATE',
  }

  it('is clean when the editor matches the saved values exactly', () => {
    expect(careerProfileIsDirty({ ...saved }, saved)).toBe(false)
  })

  it('ignores cosmetic whitespace in lists and around headline/summary', () => {
    expect(careerProfileIsDirty({ ...saved, preferredSkills: ' Tally ,  Excel ' }, saved)).toBe(false)
    expect(careerProfileIsDirty({ ...saved, headline: '  CA aspirant ' }, saved)).toBe(false)
  })

  it('is dirty when any real value changed', () => {
    expect(careerProfileIsDirty({ ...saved, headline: 'New headline' }, saved)).toBe(true)
    expect(careerProfileIsDirty({ ...saved, summary: 'Changed.' }, saved)).toBe(true)
    expect(careerProfileIsDirty({ ...saved, preferredRoleTypes: 'Accounting' }, saved)).toBe(true)
    expect(careerProfileIsDirty({ ...saved, preferredSkills: 'Tally, Excel, GST' }, saved)).toBe(true)
    expect(careerProfileIsDirty({ ...saved, preferredLocations: 'Delhi' }, saved)).toBe(true)
    expect(careerProfileIsDirty({ ...saved, workModes: 'Onsite' }, saved)).toBe(true)
    expect(careerProfileIsDirty({ ...saved, visibility: 'DISCOVERABLE' }, saved)).toBe(true)
  })

  it('is never dirty without a server-confirmed baseline', () => {
    expect(careerProfileIsDirty({ headline: 'x', summary: '', preferredRoleTypes: '', preferredSkills: '', preferredLocations: '', workModes: '', visibility: 'PRIVATE' }, null)).toBe(false)
  })
})

// ─── formatCareerDate ────────────────────────────────────────────────────────

describe('formatCareerDate', () => {
  it('formats real ISO dates and passes null/invalid through as null', () => {
    expect(formatCareerDate('2026-03-10T00:00:00.000Z')).toBe(new Date('2026-03-10T00:00:00.000Z').toLocaleDateString())
    expect(formatCareerDate(null)).toBeNull()
    expect(formatCareerDate(undefined)).toBeNull()
    expect(formatCareerDate('not-a-date')).toBeNull()
    expect(formatCareerDate('')).toBeNull()
  })
})
