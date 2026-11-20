// ─── Research normalisation & citation integrity tests (Phase 3A) ─────────────
import { describe, expect, test } from 'bun:test'
import { authorityHintFor, detectLicenseSignal, excerptContained, RESEARCH_LIMITS } from '@/lib/riishe/research'
import type { ResearchFindingDTO } from '@/lib/riishe/research'

// normalizeUrl is internal — exercised through the pipeline tests. Here we
// cover the exported pure helpers the API/UI contracts rely on.

describe('authorityHintFor — OFFICIAL requires a curated authority domain', () => {
  test('recognises known examination authorities', () => {
    expect(authorityHintFor('www.upsc.gov.in', 'UPSC')?.hint).toBe('OFFICIAL')
    expect(authorityHintFor('tnpsc.gov.in', 'TNPSC')?.hint).toBe('OFFICIAL')
    expect(authorityHintFor('ssc.nic.in')?.hint).toBe('OFFICIAL')
    expect(authorityHintFor('ibps.in')?.hint).toBe('OFFICIAL')
    expect(authorityHintFor('nta.ac.in')?.hint).toBe('OFFICIAL')
  })
  test('subdomain match works, lookalike hosts do not', () => {
    expect(authorityHintFor('cdn.upsc.gov.in')?.hint).toBe('OFFICIAL')
    expect(authorityHintFor('upsc.gov.in.evil.example.com')?.hint).not.toBe('OFFICIAL')
    expect(authorityHintFor('notupsc.gov.in.evil.io')).toBeNull()
  })
  test('gov/academic suffixes map to GOV_INSTITUTIONAL — never OFFICIAL', () => {
    expect(authorityHintFor('dept.example.gov.in')?.hint).toBe('GOV_INSTITUTIONAL')
    expect(authorityHintFor('univ.example.ac.in')?.hint).toBe('GOV_INSTITUTIONAL')
  })
  test('unknown commercial hosts get no hint (UNVERIFIED path)', () => {
    expect(authorityHintFor('someblog.example.com')).toBeNull()
    expect(authorityHintFor('questions.example.co')).toBeNull()
  })
})

describe('detectLicenseSignal — the ONLY path to verbatim storage', () => {
  test('detects explicit licence declarations', () => {
    expect(detectLicenseSignal('This paper is released under Creative Commons Attribution 4.0')).toBeTruthy()
    expect(detectLicenseSignal('content is in the public domain')).toBeTruthy()
    expect(detectLicenseSignal('licensed CC-BY-SA')).toBeTruthy()
  })
  test('returns null when no licence is declared', () => {
    expect(detectLicenseSignal('All rights reserved by the board.')).toBeNull()
    expect(detectLicenseSignal('')).toBeNull()
  })
})

describe('excerptContained — evidence excerpts must be verbatim in the source', () => {
  const text = '  The  commission\nreleased the ANSWER KEY on 12 March 2019. Question 47 asks about monsoon variability.  '
  test('accepts verbatim excerpts (whitespace/case tolerant)', () => {
    expect(excerptContained('the commission released the answer key on 12 March 2019', text)).toBe(true)
    expect(excerptContained('Question 47 asks about monsoon variability.', text)).toBe(true)
  })
  test('rejects paraphrase or invented quotes', () => {
    expect(excerptContained('the board published the key in March', text)).toBe(false)
    expect(excerptContained('The commission never released anything.', text)).toBe(false)
  })
  test('rejects too-short excerpts', () => {
    expect(excerptContained('answer key', text)).toBe(false)
  })
})

describe('citation integrity rules (finding contract)', () => {
  test('finding citation ids are bounded ordinals — UI/API trust this', () => {
    // The pipeline filters citationIds to 1..N before persisting; the type
    // contract plus this check documents the invariant the UI relies on.
    const maxOrdinal = 3
    const raw = { topic: 'Answer keys', summary: 'The key was released [1] and updated [4].', citationIds: [1, 4] }
    const ids = [...new Set(raw.citationIds.filter(n => Number.isInteger(n) && n >= 1 && n <= maxOrdinal))]
    const finding: ResearchFindingDTO = { topic: raw.topic, summary: raw.summary, citationIds: ids }
    expect(finding.citationIds).toEqual([1])
    expect(finding.summary).toContain('[4]') // text keeps the marker; UI strips unresolvable ones
  })
})

describe('research budgets are exported and sane', () => {
  test('bounded run costs (cost honesty is part of the product)', () => {
    expect(RESEARCH_LIMITS.MAX_QUERIES).toBeLessThanOrEqual(6)
    expect(RESEARCH_LIMITS.MAX_WEB_SOURCES).toBeLessThanOrEqual(18)
    expect(RESEARCH_LIMITS.MAX_PAGE_FETCHES).toBeLessThanOrEqual(6)
    expect(RESEARCH_LIMITS.MAX_PDF_FETCHES).toBeLessThanOrEqual(2)
    expect(RESEARCH_LIMITS.MAX_CANDIDATES).toBeLessThanOrEqual(10)
    expect(RESEARCH_LIMITS.EXCERPT_MAX).toBeLessThanOrEqual(300)
  })
})
