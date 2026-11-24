// ─── BEAN Classroom Intelligence (CI-3B/3E): seed domain packs ───────────────
// Eight seed packs that pass every machine gate (schema, provenance, checksum,
// risk boundaries):
//
//   CI-3B:  mathematics-statistics   STANDARD
//           computing-software-it    STANDARD
//           accounting-finance       ELEVATED   (jurisdiction sensitivity)
//           health-medicine-edu      HIGH_STAKES (charter §14 medical boundary)
//   CI-3E:  physics-space            STANDARD
//           chemistry-materials      STANDARD
//           biology-life             STANDARD
//           languages-literature     STANDARD
//
// Honest status note: all eight ship as **IN_REVIEW**. They pass the full pack
// validation suite and carry complete licence-registered provenance, but the
// charter's VERIFIED gate (§6.4) requires a recorded HUMAN reviewer — none is
// available, and the validator structurally refuses an unreviewed VERIFIED
// pack. Deterministic domain fixtures now exist (src/lib/ci/fleet/fixtures.ts)
// and run green in the CI-3E suite; the validator lets the owner's designated
// reviewer flip packs to VERIFIED without code changes once human review happens.
//
// No copyrighted source text is reproduced here — glossary entries are
// BEAN-authored concept definitions that *reference* registered sources.

import type { DomainPack } from '../domain-packs'
import { registerDomainPack } from '../domain-packs'
import { PACK_STATUS } from '../constants'
import { ensurePackSourcesRegistered } from './sources'

const VERSION = '1.0.0'
const CHANGE_NOTE = 'CI-3B initial seed pack: structure, licence-registered sources, seed glossary; fixtures land with CI-3E.'
const AT = '2026-11-24'

const SEED_LANGUAGES: DomainPack['languageSupport'] = [
  // Honest per-task language statuses — measured support lands in CI-3F;
  // until then these are EXPERIMENTAL with the fixture reference pending.
  { language: 'en', status: 'EXPERIMENTAL', task: 'TEXT_UNDERSTANDING', testRef: 'pending CI-3F benchmark', lastTestedAt: null },
  { language: 'en', status: 'EXPERIMENTAL', task: 'TERMINOLOGY', testRef: 'pending CI-3F benchmark', lastTestedAt: null },
]

const SEED_COMPETENCIES: DomainPack['competencyLevels'] = [
  { levelId: 'foundation', label: 'Foundation — core concepts and vocabulary', prerequisites: [] },
  { levelId: 'developing', label: 'Developing — procedures and worked application', prerequisites: ['foundation'] },
  { levelId: 'proficient', label: 'Proficient — multi-step reasoning and transfer', prerequisites: ['developing'] },
]

function pack(base: Omit<DomainPack, 'packVersion' | 'changeHistory'>): DomainPack {
  return {
    ...base,
    packVersion: VERSION,
    changeHistory: [{ version: VERSION, note: CHANGE_NOTE, at: AT }],
  }
}

const packs: DomainPack[] = [
  pack({
    domainId: 'mathematics-statistics',
    stableUri: 'bean:ci3:domain:mathematics-statistics',
    title: 'Mathematics, statistics and actuarial concepts',
    aliases: ['maths', 'math', 'statistics'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['05'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['physics-space', 'ai-data', 'economics-politics'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'hypothesis test', definition: 'A procedure that uses sample data to decide between competing claims about a population, reporting a statistic and an associated uncertainty rather than a certainty.', sourceId: 'openstax-mathematics', aliases: ['significance test'] },
      { term: 'derivative', definition: 'The rate at which a function output changes with its input at a point; geometrically the slope of the tangent line.', sourceId: 'openstax-mathematics', aliases: ['rate of change'] },
      { term: 'distribution', definition: 'A description of how the values of a variable (or a statistic) spread across possible outcomes.', sourceId: 'openstax-mathematics', aliases: [] },
      { term: 'correlation', definition: 'A measure of the strength and direction of association between two variables; association does not establish causation.', sourceId: 'openstax-mathematics', aliases: [] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 05 (natural sciences, mathematics and statistics)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [{ sourceId: 'openstax-mathematics', scope: 'Concept grounding and glossary anchoring for foundational mathematics and statistics' }],
    effectiveAt: AT,
    reviewDueAt: '2027-05-24',
    riskClass: 'STANDARD',
    safetyBoundary: 'Educational explanations only. Numerical work must be shown step-by-step where evidence permits; the specialist must abstain when the lesson material contains insufficient detail to check a calculation, and must never claim a computation was verified without showing the check.',
    allowedTasks: ['concept accuracy checking', 'calculation verification with shown steps', 'terminology clarity review', 'worked-example quality review'],
    prohibitedTasks: ['produce exam-grade answer keys without verification', 'grade a student or the teacher on speed'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::mathematics-statistics', 'BEAN_ASSESSMENT_SPECIALIST'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite for mathematics/statistics claims (correct, misconception, ambiguous, insufficient-evidence cases). Fixtures land with the CI-3E specialist fleet.',
      fixtureRefs: [],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  pack({
    domainId: 'computing-software-it',
    stableUri: 'bean:ci3:domain:computing-software-it',
    title: 'Computing, software engineering and information technology',
    aliases: ['computer science', 'programming', 'coding', 'IT'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['06'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['ai-data', 'cybersecurity-networks', 'mathematics-statistics'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'variable', definition: 'A named location holding a value that a program can read and change; scope rules determine where the name is visible.', sourceId: 'python-docs-psf', aliases: [] },
      { term: 'function', definition: 'A reusable unit of behaviour taking inputs and returning a result; in Python, defined with def and documented via its signature and docstring.', sourceId: 'python-docs-psf', aliases: ['procedure'] },
      { term: 'http status code', definition: 'A three-digit code returned by a web server indicating the outcome class of a request (success, redirect, client error, server error).', sourceId: 'mdn-web-docs', aliases: ['status code'] },
      { term: 'version control', definition: 'Recording and reconciling changes to source code over time so history is auditable and collaboration is safe.', sourceId: null, aliases: ['git workflow'] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 06 (Information and Communication Technologies)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [
      { sourceId: 'python-docs-psf', scope: 'Official Python semantics and standard-library behaviour (version-pinned)' },
      { sourceId: 'mdn-web-docs', scope: 'Web-platform terminology and definitions' },
    ],
    effectiveAt: AT,
    reviewDueAt: '2027-05-24',
    riskClass: 'STANDARD',
    safetyBoundary: 'Code examples must be educational, runnable-in-principle and version-labelled. Security topics stay conceptual for learners; no operational exploit instructions, no credential handling advice beyond general best practice.',
    allowedTasks: ['concept accuracy checking', 'terminology review', 'code-example reasonableness review', 'version-sensitivity flagging'],
    prohibitedTasks: ['provide operational exploit or attack instructions', 'run or execute untrusted code'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::computing-software-it', 'BEAN_ASSESSMENT_SPECIALIST'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite for computing claims (correct, version-sensitive, ambiguous, insufficient-evidence cases). Fixtures land with CI-3E.',
      fixtureRefs: [],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  pack({
    domainId: 'accounting-finance',
    stableUri: 'bean:ci3:domain:accounting-finance',
    title: 'Accounting, taxation, banking, insurance and finance education',
    aliases: ['finance', 'accountancy', 'commerce'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['04'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['mathematics-statistics', 'business-management', 'economics-politics'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'asset', definition: 'A resource controlled by an entity from which future economic benefit is expected; classified by liquidity or permanence in teaching contexts.', sourceId: 'un-feed-the-minds-financial-literacy-note', aliases: [] },
      { term: 'compound interest', definition: 'Interest computed on both the original principal and previously accumulated interest; the accumulation schedule depends on the compounding period.', sourceId: 'un-feed-the-minds-financial-literacy-note', aliases: [] },
      { term: 'liability', definition: 'A present obligation arising from past events whose settlement is expected to transfer resources.', sourceId: 'un-feed-the-minds-financial-literacy-note', aliases: [] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 04 (business, administration and law)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [{ sourceId: 'un-feed-the-minds-financial-literacy-note', scope: 'BEAN-authored concept seed (no external regulatory dataset imported yet)' }],
    effectiveAt: AT,
    reviewDueAt: '2027-02-24',
    riskClass: 'ELEVATED',
    safetyBoundary: 'Concepts and worked educational examples only, always tagged with the jurisdiction and period when the lesson implies one. The specialist never produces personalised investment, lending, insurance or tax-filing decisions and never presents a rate rule as current without a dated, jurisdiction-specific source.',
    allowedTasks: ['concept definition review', 'worked-example arithmetic with shown steps', 'jurisdiction/date sensitivity flagging', 'terminology clarity'],
    prohibitedTasks: ['personalised investment or tax advice', 'regulatory-compliance determinations', 'presenting unstated jurisdiction as universal'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::accounting-finance'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite for finance concepts with jurisdiction/date-sensitivity cases. Fixtures land with CI-3E.',
      fixtureRefs: [],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  pack({
    domainId: 'health-medicine-edu',
    stableUri: 'bean:ci3:domain:health-medicine-edu',
    title: 'Health sciences and medicine education',
    aliases: ['biology-health', 'medical education'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['09'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['biology-life', 'nursing-allied-health', 'chemistry-materials'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'homeostasis', definition: 'The maintenance of relatively stable internal conditions in an organism through regulated feedback mechanisms.', sourceId: 'openstax-anatomy-physiology', aliases: [] },
      { term: 'neuron', definition: 'The specialised cell of the nervous system that transmits electrical and chemical signals.', sourceId: 'openstax-anatomy-physiology', aliases: ['nerve cell'] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 09 (health and welfare)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [{ sourceId: 'openstax-anatomy-physiology', scope: 'Educational anatomy/physiology concept grounding (never clinical guidance)' }],
    effectiveAt: AT,
    reviewDueAt: '2027-02-24',
    riskClass: 'HIGH_STAKES',
    safetyBoundary: 'Charter §14 health boundary: explain educational concepts and public-health guidance at most; never diagnose, prescribe or recommend personalised treatment; emergencies route to local emergency services; health discussions stay out of personal student profiles.',
    allowedTasks: ['educational concept review', 'public-health guidance framing check', 'terminology clarity'],
    prohibitedTasks: ['diagnosis or treatment recommendation', 'dosage or medication guidance', 'clinical decision support'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::health-medicine-edu'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite including refusal cases (diagnosis/dosage requests must route to professional help). Fixtures land with CI-3E.',
      fixtureRefs: [],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  // ─── CI-3E: core domain families expanded (charter §19 CI-3E) ────────────────
  // Four further core-family packs following the CI-3B seed pattern. All are
  // IN_REVIEW for the same honest reason as the originals: the charter's
  // VERIFIED gate requires a recorded human reviewer, which no milestone can
  // fabricate. The registered sources (OpenStax science series, NCERT,
  // CEFR Companion Volume) were added to the source registry in CI-3E.

  pack({
    domainId: 'physics-space',
    stableUri: 'bean:ci3:domain:physics-space',
    title: 'Physics, astronomy and space sciences',
    aliases: ['physics', 'astronomy'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['05'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['mathematics-statistics', 'chemistry-materials', 'engineering'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'momentum', definition: 'The quantity of motion of a body, product of its mass and velocity; conserved in isolated systems.', sourceId: 'openstax-science-series', aliases: [] },
      { term: 'energy conservation', definition: 'Energy is neither created nor destroyed in an isolated system; it changes form.', sourceId: 'openstax-science-series', aliases: ['conservation of energy'] },
      { term: 'orbital motion', definition: 'Motion of a body under the influence of a central gravitational force, following a conic-section path in the two-body idealisation.', sourceId: 'openstax-science-series', aliases: ['orbits'] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 05 (natural sciences, mathematics and statistics)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [{ sourceId: 'openstax-science-series', scope: 'Physics/astronomy concept grounding and glossary anchoring' }],
    effectiveAt: AT,
    reviewDueAt: '2027-05-24',
    riskClass: 'STANDARD',
    safetyBoundary: 'Educational explanations only. Any worked calculation must show its steps and units; the specialist abstains when the lesson material lacks the numbers or assumptions needed to check a result, and never presents a reproduced diagram or third-party figure as its own.',
    allowedTasks: ['concept accuracy checking', 'calculation verification with shown steps', 'terminology clarity review', 'unit and order-of-magnitude sanity checks'],
    prohibitedTasks: ['produce exam-grade answer keys without verification', 'safety-critical engineering guidance (structures, electrical installations)'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::physics-space'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite for physics claims (correct, misconception, ambiguous, insufficient-evidence cases) — see src/lib/ci/fleet/fixtures.ts.',
      fixtureRefs: ['ci3-fixture-physics-misconception', 'ci3-fixture-grounding-generic'],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  pack({
    domainId: 'chemistry-materials',
    stableUri: 'bean:ci3:domain:chemistry-materials',
    title: 'Chemistry and materials science',
    aliases: ['chemistry'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['05'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['physics-space', 'biology-life', 'engineering'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'mole', definition: 'The amount of substance containing as many elementary entities as there are atoms in 0.012 kg of carbon-12.', sourceId: 'openstax-science-series', aliases: ['amount of substance'] },
      { term: 'chemical bond', definition: 'A lasting attraction between atoms, ions or molecules that enables the formation of chemical compounds.', sourceId: 'openstax-science-series', aliases: ['bonding'] },
      { term: 'oxidation state', definition: 'A formalism that tracks the hypothetical charge of an atom in a compound under assigned electron-accounting rules.', sourceId: 'openstax-science-series', aliases: ['oxidation number'] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 05 (natural sciences, mathematics and statistics)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [{ sourceId: 'openstax-science-series', scope: 'Chemistry concept grounding and glossary anchoring' }],
    effectiveAt: AT,
    reviewDueAt: '2027-05-24',
    riskClass: 'STANDARD',
    safetyBoundary: 'Educational explanations only. Chemical-safety content stays at general education level; the specialist never gives synthesis routes for hazardous, controlled or weaponisable substances and routes any safety incident to qualified adults and emergency guidance.',
    allowedTasks: ['concept accuracy checking', 'terminology clarity review', 'reaction-description sanity checks at education level'],
    prohibitedTasks: ['hazardous-synthesis instructions', 'exam-grade answer keys without verification'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::chemistry-materials'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite including refusal cases (hazardous-synthesis requests must be refused). Fixtures see src/lib/ci/fleet/fixtures.ts.',
      fixtureRefs: ['ci3-fixture-chemistry-refusal', 'ci3-fixture-grounding-generic'],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  pack({
    domainId: 'biology-life',
    stableUri: 'bean:ci3:domain:biology-life',
    title: 'Biology, biotechnology and life sciences',
    aliases: ['biology', 'life sciences'],
    translations: [],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['05'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['health-medicine-edu', 'chemistry-materials', 'environment-earth'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'cell theory', definition: 'The principle that living organisms are composed of cells, that the cell is the basic unit of life, and that cells arise from pre-existing cells.', sourceId: 'openstax-science-series', aliases: [] },
      { term: 'photosynthesis', definition: 'The process by which photosynthetic organisms convert light energy into chemical energy stored in carbohydrates.', sourceId: 'openstax-science-series', aliases: [] },
      { term: 'natural selection', definition: 'The differential survival and reproduction of individuals due to phenotypic differences, changing allele frequencies across generations.', sourceId: 'openstax-science-series', aliases: ['selection'] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 05 (natural sciences, mathematics and statistics)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
    ],
    sources: [{ sourceId: 'openstax-science-series', scope: 'Biology/life-sciences concept grounding and glossary anchoring' }],
    effectiveAt: AT,
    reviewDueAt: '2027-05-24',
    riskClass: 'STANDARD',
    safetyBoundary: 'Educational explanations only. Adjacent health questions route to the health-medicine-edu boundary (never diagnosis or treatment); genetic or biotechnology content stays at concept level and never supports self-experimentation or pathogen handling.',
    allowedTasks: ['concept accuracy checking', 'terminology clarity review', 'curriculum-alignment sanity checks'],
    prohibitedTasks: ['diagnosis or treatment recommendation', 'pathogen or bioweapon handling guidance', 'personal genetic advice'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::biology-life'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite for biology claims including refusal cases (health-adjacent questions route to the §14 boundary).',
      fixtureRefs: ['ci3-fixture-grounding-generic'],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),

  pack({
    domainId: 'languages-literature',
    stableUri: 'bean:ci3:domain:languages-literature',
    title: 'Languages, linguistics, literature and translation',
    aliases: ['english', 'languages', 'literature', 'grammar'],
    translations: [
      { language: 'hi', title: 'भाषा, भाषाविज्ञान और साहित्य' },
      { language: 'ta', title: 'மொழி, மொழியியல் மற்றும் இலக்கியம்' },
    ],
    taxonomySourceId: 'unesco-isced-f-2013',
    taxonomyVersion: 'ISCED-F 2013',
    iscedCodes: ['02'],
    parentDomainId: null,
    childDomainIds: [],
    relatedSubjectDomainIds: ['education-pedagogy', 'history-philosophy', 'journalism-media-info'],
    relatedProfessionNote: null,
    competencyLevels: SEED_COMPETENCIES,
    glossary: [
      { term: 'CEFR level', definition: 'A proficiency band (A1–C2) of the Common European Framework of Reference describing what a learner can do with language.', sourceId: 'cefr-companion-volume', aliases: ['CEFR'] },
      { term: 'comprehensible input', definition: 'Language input slightly above the learner\u2019s current level that remains understandable in context, a central concept in second-language acquisition teaching.', sourceId: null, aliases: [] },
      { term: 'literal translation', definition: 'A word-for-word rendering that preserves surface form rather than meaning; often misleading between unrelated languages.', sourceId: null, aliases: [] },
    ],
    standards: [
      { label: 'ISCED-F 2013 broad field 02 (arts and humanities)', jurisdiction: 'international reference', sourceId: 'unesco-isced-f-2013' },
      { label: 'CEFR Companion Volume level descriptors (referenced, never reproduced)', jurisdiction: 'international reference', sourceId: 'cefr-companion-volume' },
    ],
    sources: [
      { sourceId: 'cefr-companion-volume', scope: 'Language-level descriptor reference (cited, never reproduced)' },
      { sourceId: 'ncert-textbooks', scope: 'Indian school language-curriculum concept anchoring' },
    ],
    effectiveAt: AT,
    reviewDueAt: '2027-05-24',
    riskClass: 'STANDARD',
    safetyBoundary: 'Language-learning support only. The specialist preserves regional and dialect variation (charter §8), never claims fluency or certification on a learner\u2019s behalf, and treats a translated term as unverified unless a pack source anchors it.',
    allowedTasks: ['grammar and usage checking at class level', 'terminology clarity review', 'language-level descriptor referencing (cited)'],
    prohibitedTasks: ['official certification or immigration-document language claims', 'reproduce copyrighted texts'],
    agentProfileIds: ['BEAN_SUBJECT_EXPERT::languages-literature'],
    languageSupport: SEED_LANGUAGES,
    benchmark: {
      suiteId: 'ci3-domain-fixture-suite',
      description: 'Deterministic fixture suite for language/translation claims (code-switch preservation, unverified-translation honesty). Fixtures see src/lib/ci/fleet/fixtures.ts.',
      fixtureRefs: ['ci3-fixture-languages-unverified-translation', 'ci3-fixture-grounding-generic'],
      lastResult: null,
    },
    status: PACK_STATUS.IN_REVIEW,
    humanReview: null,
  }),
]

let registered = false

/** Register the seed packs (idempotent). Sources are registered first. */
export function ensureSeedPacksRegistered(): void {
  if (registered) return
  ensurePackSourcesRegistered()
  for (const p of packs) {
    const result = registerDomainPack(p)
    if (!result.ok) throw new Error(`seed pack registration failed for ${p.domainId}: ${result.reason}`)
  }
  registered = true
}

/** Clear the once-only flag so the next ensure call re-registers (tests only). */
export function resetSeedPacksForTests(): void {
  registered = false
}

// Auto-register on import (same pattern as the CI-1 pipeline module).
ensureSeedPacksRegistered()
