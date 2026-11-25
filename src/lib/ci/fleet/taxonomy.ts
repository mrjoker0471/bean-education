// ─── BEAN Classroom Intelligence (CI-3B): subject & profession taxonomy ──────
// Adapter between BEAN's class metadata and the charter's knowledge hierarchy
// (charter §6.2, §6.3):
//
//   Subject :  Field → Domain → Subject → Subsubject → Topic → Concept
//              → Skill → Learning objective → Assessment objective
//   Profession: Occupation family → Occupation → Specialisation → Role
//              → Competency → Skill → Knowledge concept → Training pathway
//
// Seed reference taxonomy: UNESCO ISCED-F 2013 broad fields (11 fields,
// factual, publicly documented classification names — recorded with full
// provenance in the source registry). ESCO / O*NET occupation data is NOT
// imported in CI-3B: the profession side ships the type structure + an
// explicit "licence import pending" gate (charter §3.5) so nothing can claim
// coverage it does not have.
//
// Resolution is deterministic token matching over this seed; it reports
// `matchedOn` evidence or an honest empty result. It maps INTO BEAN's domain
// families — it does not replace BEAN's existing subject/syllabus catalogue.

import { z } from 'zod'
import { registerSource } from './sources'
import { SOURCE_QUALITY_CLASS, FLEET_MAX_DOMAINS_PER_CLASS } from './constants'

// ─── ISCED-F 2013 broad fields (seed reference) ──────────────────────────────

export const ISCED_F_BROAD_FIELDS = [
  { code: '00', name: 'Generic programmes and qualifications' },
  { code: '01', name: 'Education' },
  { code: '02', name: 'Arts and humanities' },
  { code: '03', name: 'Social sciences, journalism and information' },
  { code: '04', name: 'Business, administration and law' },
  { code: '05', name: 'Natural sciences, mathematics and statistics' },
  { code: '06', name: 'Information and Communication Technologies' },
  { code: '07', name: 'Engineering, manufacturing and construction' },
  { code: '08', name: 'Agriculture, forestry, fisheries and veterinary' },
  { code: '09', name: 'Health and welfare' },
  { code: '10', name: 'Services' },
] as const

export type IscedBroadField = (typeof ISCED_F_BROAD_FIELDS)[number]

// ─── BEAN domain families (charter §6.1 — the 36 seed families) ──────────────

export interface DomainFamily {
  /** Stable domain id used in pack ids and subject-expert instance ids. */
  domainId: string
  title: string
  /** ISCED-F broad-field codes this family falls under. */
  iscedCodes: readonly string[]
  /** Deterministic matching tokens (lowercase) for subject resolution. */
  matchTokens: readonly string[]
}

export const DOMAIN_FAMILIES: readonly DomainFamily[] = [
  { domainId: 'education-pedagogy', title: 'Education, pedagogy and learning sciences', iscedCodes: ['01'], matchTokens: ['education', 'pedagogy', 'teaching', 'learning science', 'lesson design'] },
  { domainId: 'mathematics-statistics', title: 'Mathematics, statistics and actuarial concepts', iscedCodes: ['05'], matchTokens: ['mathematics', 'maths', 'math', 'statistics', 'algebra', 'geometry', 'calculus', 'probability', 'actuarial', 'arithmetic', 'trigonometry'] },
  { domainId: 'physics-space', title: 'Physics, astronomy and space sciences', iscedCodes: ['05'], matchTokens: ['physics', 'astronomy', 'space science', 'mechanics', 'optics', 'thermodynamics'] },
  { domainId: 'chemistry-materials', title: 'Chemistry and materials science', iscedCodes: ['05'], matchTokens: ['chemistry', 'materials science', 'organic chemistry', 'inorganic chemistry'] },
  { domainId: 'biology-life', title: 'Biology, biotechnology and life sciences', iscedCodes: ['05'], matchTokens: ['biology', 'biotechnology', 'life sciences', 'botany', 'zoology', 'genetics', 'microbiology'] },
  { domainId: 'environment-earth', title: 'Environment, climate and earth sciences', iscedCodes: ['05'], matchTokens: ['environment', 'climate', 'earth science', 'geology', 'meteorology', 'geography', 'ecology'] },
  { domainId: 'computing-software-it', title: 'Computing, software engineering and information technology', iscedCodes: ['06'], matchTokens: ['computer science', 'computing', 'software', 'programming', 'information technology', 'coding', 'informatics', 'web development'] },
  { domainId: 'ai-data', title: 'Artificial intelligence, data science and analytics', iscedCodes: ['06', '05'], matchTokens: ['artificial intelligence', 'machine learning', 'data science', 'analytics', 'deep learning', 'ai'] },
  { domainId: 'cybersecurity-networks', title: 'Cybersecurity, networking and telecommunications', iscedCodes: ['06'], matchTokens: ['cybersecurity', 'networking', 'telecommunications', 'information security'] },
  { domainId: 'engineering', title: 'Engineering: civil, mechanical, electrical, electronics, chemical, industrial', iscedCodes: ['07'], matchTokens: ['engineering', 'civil engineering', 'mechanical engineering', 'electrical engineering', 'electronics', 'industrial engineering'] },
  { domainId: 'architecture-built', title: 'Architecture, planning, construction and built environment', iscedCodes: ['07'], matchTokens: ['architecture', 'urban planning', 'construction', 'built environment'] },
  { domainId: 'manufacturing-quality', title: 'Manufacturing, automation, maintenance and quality', iscedCodes: ['07'], matchTokens: ['manufacturing', 'automation', 'maintenance', 'quality control'] },
  { domainId: 'health-medicine-edu', title: 'Health sciences and medicine education', iscedCodes: ['09'], matchTokens: ['medicine', 'health science', 'medical education', 'anatomy', 'physiology'] },
  { domainId: 'nursing-allied-health', title: 'Nursing, allied health, public health and health administration', iscedCodes: ['09'], matchTokens: ['nursing', 'public health', 'allied health', 'health administration', 'pharmacy'] },
  { domainId: 'veterinary-food', title: 'Veterinary science, animal care and food systems', iscedCodes: ['08'], matchTokens: ['veterinary', 'animal care', 'food science', 'animal husbandry'] },
  { domainId: 'agriculture-agritech', title: 'Agriculture, horticulture, forestry, fisheries and agritech', iscedCodes: ['08'], matchTokens: ['agriculture', 'horticulture', 'forestry', 'fisheries', 'agritech', 'agronomy'] },
  { domainId: 'business-management', title: 'Business, management, entrepreneurship and operations', iscedCodes: ['04'], matchTokens: ['business', 'management', 'entrepreneurship', 'operations', 'marketing'] },
  { domainId: 'accounting-finance', title: 'Accounting, taxation, banking, insurance and finance education', iscedCodes: ['04'], matchTokens: ['accounting', 'taxation', 'banking', 'insurance', 'finance', 'financial literacy'] },
  { domainId: 'law-governance', title: 'Law, governance, public policy and civic education', iscedCodes: ['04'], matchTokens: ['law', 'legal', 'governance', 'public policy', 'civic education', 'constitution'] },
  { domainId: 'economics-politics', title: 'Economics, political science and international relations', iscedCodes: ['03', '04'], matchTokens: ['economics', 'political science', 'international relations', 'macroeconomics', 'microeconomics'] },
  { domainId: 'psychology-social', title: 'Psychology, sociology, anthropology and social work', iscedCodes: ['03'], matchTokens: ['psychology', 'sociology', 'anthropology', 'social work'] },
  { domainId: 'history-philosophy', title: 'History, geography, philosophy and archaeology', iscedCodes: ['02'], matchTokens: ['history', 'philosophy', 'archaeology', 'heritage'] },
  { domainId: 'languages-literature', title: 'Languages, linguistics, literature and translation', iscedCodes: ['02'], matchTokens: ['language', 'linguistics', 'literature', 'translation', 'grammar', 'english', 'tamil', 'hindi', 'sanskrit'] },
  { domainId: 'journalism-media-info', title: 'Journalism, communication, publishing and information science', iscedCodes: ['03'], matchTokens: ['journalism', 'communication', 'publishing', 'information science', 'library'] },
  { domainId: 'arts-design-crafts', title: 'Fine arts, visual design, industrial design and crafts', iscedCodes: ['02'], matchTokens: ['fine arts', 'visual design', 'industrial design', 'painting', 'sculpture', 'crafts'] },
  { domainId: 'performing-arts', title: 'Music, theatre, dance, film and performing arts', iscedCodes: ['02'], matchTokens: ['music', 'theatre', 'dance', 'film', 'performing arts'] },
  { domainId: 'media-animation-games', title: 'Media production, animation, photography and game development', iscedCodes: ['06', '02'], matchTokens: ['media production', 'animation', 'photography', 'game development', 'film making'] },
  { domainId: 'hospitality-tourism', title: 'Hospitality, tourism, culinary arts and personal services', iscedCodes: ['10'], matchTokens: ['hospitality', 'tourism', 'culinary', 'hotel management', 'catering'] },
  { domainId: 'transport-logistics', title: 'Transport, aviation, maritime, logistics and supply chains', iscedCodes: ['10', '07'], matchTokens: ['transport', 'aviation', 'maritime', 'logistics', 'supply chain'] },
  { domainId: 'public-safety-emergency', title: 'Public safety, emergency services and security education', iscedCodes: ['10'], matchTokens: ['public safety', 'emergency services', 'fire safety', 'disaster management'] },
  { domainId: 'sports-pe-coaching', title: 'Sports science, physical education and coaching', iscedCodes: ['10'], matchTokens: ['sports science', 'physical education', 'coaching', 'fitness'] },
  { domainId: 'sustainability-energy', title: 'Sustainability, renewable energy and circular economy', iscedCodes: ['05', '07'], matchTokens: ['sustainability', 'renewable energy', 'circular economy', 'solar', 'climate action'] },
  { domainId: 'skilled-trades', title: 'Skilled trades: electrical, plumbing, welding, automotive, HVAC and repair', iscedCodes: ['07'], matchTokens: ['skilled trades', 'electrical trade', 'plumbing', 'welding', 'automotive repair', 'hvac', 'carpentry'] },
  { domainId: 'retail-sales-commerce', title: 'Retail, sales, customer service and commerce', iscedCodes: ['04', '10'], matchTokens: ['retail', 'sales', 'customer service', 'commerce', 'e-commerce'] },
  { domainId: 'public-admin-nonprofit', title: 'Public administration, community services and non-profit work', iscedCodes: ['04', '03'], matchTokens: ['public administration', 'community service', 'non-profit', 'civil service'] },
  { domainId: 'interdisciplinary-emerging', title: 'Interdisciplinary and emerging professions', iscedCodes: ['00'], matchTokens: ['interdisciplinary', 'emerging profession', 'cross-disciplinary'] },
] as const

export function getDomainFamily(domainId: string): DomainFamily | null {
  return DOMAIN_FAMILIES.find(f => f.domainId === domainId) ?? null
}

// ─── Provenance registration ─────────────────────────────────────────────────

let taxonomySourcesRegistered = false

/**
 * Register the taxonomy's provenance in the source/licence registry. Idempotent.
 * ISCED-F 2013 field names are factual classification data published by the
 * UNESCO Institute for Statistics; the registry entry records the reference
 * and the attribution obligation that applies when ISCED-derived content is
 * used beyond these public broad-field names.
 */
export function ensureTaxonomySourcesRegistered(): void {
  if (taxonomySourcesRegistered) return
  registerSource({
    sourceId: 'unesco-isced-f-2013',
    title: 'UNESCO ISCED-F 2013 — International Standard Classification of Education: Fields of Education and Training',
    canonicalRef: 'https://uis.unesco.org/en/methods-and-tools/isced',
    publisher: 'UNESCO Institute for Statistics',
    authors: [],
    publishedAt: '2013',
    jurisdiction: null,
    version: 'ISCED-F 2013',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: null,
      statement:
        'UNESCO publishes ISCED classifications for reuse with attribution for educational and research purposes; exact current reuse terms must be re-read from the UNESCO UIS terms page before any content beyond the public broad-field names is imported. CI-3B imports only the 11 broad-field codes and names as a factual seed.',
      verifiedAt: '2026-11-24',
    },
    permittedUse:
      'Reference seed for subject-field classification (broad fields only in CI-3B); attribution required on derived published content; recheck terms before deeper import.',
    attribution:
      'Field codes/names © UNESCO Institute for Statistics, ISCED-F 2013 (uis.unesco.org), used as a classification reference seed.',
  })
  taxonomySourcesRegistered = true
}

/** Clear the once-only flag so the next ensure call re-registers (tests only). */
export function resetTaxonomySourcesForTests(): void {
  taxonomySourcesRegistered = false
}

// ─── Subject → domain resolution (deterministic, honest) ─────────────────────

export type SubjectDomainResolution =
  | { matched: true; domains: { domainId: string; matchedOn: string[]; iscedCodes: string[] }[]; truncated: boolean }
  | { matched: false; domains: []; reason: string }

const SUBJECT_STOPWORDS = new Set(['and', 'the', 'of', 'for', 'with', 'a', 'an', 'in', 'to', 'class', 'lesson', 'introduction', 'basics', 'fundamentals'])

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s+#.-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Resolve a lesson subject/title string to candidate BEAN domain families.
 * Deterministic token matching over the curated seed; reports exactly which
 * token matched each family (`matchedOn`). Returns an honest `matched: false`
 * when nothing matches — the dispatcher must treat unknown subjects as
 * "no specialist dispatch" rather than guessing (charter §10.2 reaction
 * matrix: "Question is outside the selected subject → say it is outside
 * current capability").
 *
 * @param subjectText free text from class metadata (subject, title)
 * @param limit max families returned (default FLEET_MAX_DOMAINS_PER_CLASS)
 */
export function resolveDomainsForSubject(subjectText: string, limit: number = FLEET_MAX_DOMAINS_PER_CLASS): SubjectDomainResolution {
  ensureTaxonomySourcesRegistered()
  const text = normalise(subjectText ?? '')
  if (text.length < 2) return { matched: false, domains: [], reason: 'empty subject text' }

  const scored: { domainId: string; matchedOn: string[]; iscedCodes: string[]; score: number }[] = []
  for (const family of DOMAIN_FAMILIES) {
    const matchedOn: string[] = []
    for (const token of family.matchTokens) {
      // Word-boundary match so "art" does not trigger inside "smart".
      const re = new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
      if (re.test(text)) matchedOn.push(token)
    }
    if (matchedOn.length > 0) {
      scored.push({
        domainId: family.domainId,
        matchedOn: [...matchedOn].sort(),
        iscedCodes: [...family.iscedCodes],
        score: Math.max(...matchedOn.map(t => t.length)) + matchedOn.length * 0.5,
      })
    }
  }

  if (scored.length === 0) return { matched: false, domains: [], reason: 'no domain family matched' }

  scored.sort((a, b) => b.score - a.score || a.domainId.localeCompare(b.domainId))
  const truncated = scored.length > limit
  return {
    matched: true,
    domains: scored.slice(0, limit).map(({ domainId, matchedOn, iscedCodes }) => ({ domainId, matchedOn, iscedCodes })),
    truncated,
  }
}

// ─── Profession hierarchy types (charter §6.3 — structure first) ─────────────

export const professionNodeSchema = z.object({
  nodeId: z.string().min(3).max(120),
  nodeType: z.enum(['OCCUPATION_FAMILY', 'OCCUPATION', 'SPECIALISATION', 'ROLE', 'COMPETENCY', 'SKILL', 'KNOWLEDGE_CONCEPT', 'TRAINING_PATHWAY']),
  label: z.string().min(1).max(300),
  /** Original upstream identifier, once a dataset is imported (e.g. ESCO uri). */
  externalId: z.string().max(300).nullable(),
  /** Taxonomy source id from the source registry that authored this node. */
  sourceId: z.string().min(3).max(100).nullable(),
  parentNodeId: z.string().max(120).nullable(),
  jurisdiction: z.string().max(100).nullable(),
})
export type ProfessionNode = z.infer<typeof professionNodeSchema>

/**
 * Profession taxonomy import state. CI-3B ships the node structure only —
 * importing ESCO/O*NET rows requires the per-source licence validation gate
 * (charter §3.5) which has not been executed by a human yet, so the adapter
 * reports `importState: 'LICENCE_GATE_PENDING'` and refuses to serve nodes
 * beyond the empty seed. No fabricated occupation data, ever.
 */
export const PROFESSION_IMPORT_STATE = 'LICENCE_GATE_PENDING' as const

export function professionCatalogue(): { importState: typeof PROFESSION_IMPORT_STATE; nodes: ProfessionNode[]; note: string } {
  return {
    importState: PROFESSION_IMPORT_STATE,
    nodes: [],
    note:
      'This CI-3B structure is superseded for profession data by the CI-4B world-taxonomy layer (src/lib/ci/fleet/world-taxonomy.ts): curated O*NET occupation mappings are imported there (METADATA_SEED_IMPORTED) while ESCO stays at its licence gate pending licence verification and NCO/NSQF remain no-import/citation-only. No occupation content is claimed here.',
  }
}

// ─── Subject hierarchy node (for pack authoring) ─────────────────────────────

export const subjectNodeSchema = z.object({
  subjectId: z.string().min(3).max(120),
  label: z.string().min(1).max(300),
  level: z.enum(['FIELD', 'DOMAIN', 'SUBJECT', 'SUBSUBJECT', 'TOPIC', 'CONCEPT', 'SKILL', 'LEARNING_OBJECTIVE', 'ASSESSMENT_OBJECTIVE']),
  parentNodeId: z.string().max(120).nullable(),
  iscedCode: z.string().max(8).nullable(),
  sourceId: z.string().min(3).max(100).nullable(),
})
export type SubjectNode = z.infer<typeof subjectNodeSchema>
