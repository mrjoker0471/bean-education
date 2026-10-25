// ─────────────────────────────────────────────────────────────────────────────
// BEAN EXAMS — Catalogue seed data (import source; DB is the runtime source of
// truth). Every exam here is a real Indian competitive examination with its
// actual conducting authority. Patterns recorded only where well established.
// All syllabus trees are honestly marked PARTIAL/UNVERIFIED — see worklog.
// ─────────────────────────────────────────────────────────────────────────────

export interface StagePattern {
  durationMin: number
  totalQuestions: number
  totalMarks: number
  negativeMark: number // marks deducted per wrong answer
  marksPerQuestion?: number // marks awarded per correct answer (default 1)
  qualifying?: string
  sections: { name: string; questions: number; marks: number; durationMin?: number }[]
}

export interface TopicSeed {
  slug: string
  name: string
  canonical?: string
  description?: string
}

export interface UnitSeed {
  slug: string
  name: string
  description?: string
  topics: TopicSeed[]
}

export interface SubjectSeed {
  slug: string
  name: string
  description?: string
  icon?: string
  units: UnitSeed[]
}

export interface StageSeed {
  slug: string
  name: string
  paperNote?: string
  pattern?: StagePattern
  subjects: SubjectSeed[]
}

export interface ExamSeed {
  slug: string
  name: string
  shortName?: string
  authority: string
  category: string
  state?: string
  description: string
  featured?: boolean
  syllabusStatus: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED'
  contentNote?: string
  sourceRefs?: { label: string; url: string }[]
  stages: StageSeed[]
}

export const CATEGORIES: { slug: string; name: string; description: string }[] = [
  { slug: 'tamil-nadu', name: 'Tamil Nadu Government Exams', description: 'TNPSC, TNUSRB, TRB and other Tamil Nadu state recruitment and eligibility examinations.' },
  { slug: 'upsc-central', name: 'UPSC & Central Government', description: 'Civil Services, Forest Service, Economic/Statistical Service and central recruitment by UPSC.' },
  { slug: 'ssc', name: 'SSC Exams', description: 'Staff Selection Commission examinations for graduate, 10+2 and matriculate level posts.' },
  { slug: 'banking-insurance', name: 'Banking & Insurance', description: 'IBPS, SBI, RBI, NABARD, LIC and insurance-sector recruitment examinations.' },
  { slug: 'railways', name: 'Railway Exams', description: 'Railway Recruitment Board and RPF examinations for NTPC, Group D, ALP, Technician and more.' },
  { slug: 'defence-police', name: 'Defence & Uniformed Services', description: 'NDA, CDS, AFCAT, Agniveer, CAPF and state police recruitment examinations.' },
  { slug: 'engineering-medical', name: 'Engineering & Medical Entrance', description: 'JEE, GATE, NEET and other engineering, medical and health-science entrance examinations.' },
  { slug: 'university-professional', name: 'University & Professional Entrance', description: 'CUET, CLAT, CAT, design and other university and professional programme entrances.' },
  { slug: 'teaching-research', name: 'Teaching & Eligibility', description: 'CTET, State TETs, UGC NET, CSIR NET and school/college teaching recruitment.' },
  { slug: 'other-states', name: 'Other State Government Exams', description: 'State PSC combined services, police and eligibility examinations across India.' },
]

// ─── Reusable syllabus tree builders ─────────────────────────────────────────

const t = (slug: string, name: string, canonical?: string, description?: string): TopicSeed =>
  canonical ? { slug, name, canonical, description } : { slug, name, description }

// Indian Polity & Governance unit
const polityUnit = (): UnitSeed => ({
  slug: 'polity', name: 'Indian Polity & Governance',
  description: 'Constitution, rights, union and state government, judiciary and administration.',
  topics: [
    t('constitution-basics', 'Making of the Constitution & Preamble', 'polity-constitution'),
    t('fundamental-rights', 'Fundamental Rights, Duties & Directive Principles', 'polity-fundamental-rights'),
    t('union-executive', 'Union Executive: President, PM & Council of Ministers', 'polity-union-executive'),
    t('parliament', 'Parliament: Lok Sabha & Rajya Sabha', 'polity-parliament'),
    t('judiciary', 'Judiciary: Supreme Court & High Courts', 'polity-judiciary'),
    t('state-government', 'State Government & Administration'),
    t('panchayati-raj', 'Panchayati Raj & Local Governance', 'polity-panchayati-raj'),
    t('constitutional-bodies', 'Constitutional & Statutory Bodies', 'polity-constitutional-bodies'),
  ],
})

// TNPSC-specific polity/administration unit
const tnPolityUnit = (): UnitSeed => ({
  slug: 'tn-administration', name: 'Tamil Nadu Administration & Development',
  description: 'TN governance structure, socio-economic development and welfare administration.',
  topics: [
    t('tn-admin-structure', 'Administrative Structure of Tamil Nadu', 'polity-tn-administration'),
    t('tn-socio-economic', 'Socio-Economic Development in Tamil Nadu', 'economy-tn'),
    t('tn-welfare-schemes', 'TN Welfare Schemes & e-Governance', 'polity-tn-administration'),
  ],
})

const historyUnitTn = (): UnitSeed => ({
  slug: 'history', name: 'History & Culture of India',
  topics: [
    t('ancient-india', 'Ancient India', 'history-ancient'),
    t('medieval-india', 'Medieval India', 'history-medieval'),
    t('modern-india', 'Modern India', 'history-modern'),
    t('tn-history-culture', 'Tamil Nadu History & Culture', 'history-tn'),
    t('national-movement', 'Indian National Movement', 'history-national-movement'),
  ],
})

const geographyUnit = (): UnitSeed => ({
  slug: 'geography', name: 'Geography',
  topics: [
    t('india-relief-drainage', 'India: Relief & Drainage', 'geography-india'),
    t('india-climate', 'India: Climate & Monsoon', 'geography-india'),
    t('tn-geography', 'Geography of Tamil Nadu', 'geography-tn'),
    t('world-geography', 'World Geography Basics', 'geography-world'),
  ],
})

const economyUnit = (): UnitSeed => ({
  slug: 'economy', name: 'Indian Economy',
  topics: [
    t('economy-basics', 'Indian Economy: Basics & Planning', 'economy-basics'),
    t('banking-rbi', 'Banking System & RBI', 'economy-banking'),
    t('tn-economy', 'Economy of Tamil Nadu', 'economy-tn'),
  ],
})

const scienceUnit = (): UnitSeed => ({
  slug: 'science', name: 'General Science',
  topics: [
    t('physics-everyday', 'Physics: Everyday Concepts', 'science-physics'),
    t('chemistry-everyday', 'Chemistry: Everyday Concepts', 'science-chemistry'),
    t('biology-everyday', 'Biology: Human Body & Life Processes', 'science-biology'),
    t('space-solar-system', 'Space & Solar System', 'science-space'),
  ],
})

const environmentUnit = (): UnitSeed => ({
  slug: 'environment', name: 'Environment & Ecology',
  topics: [t('ecology-biodiversity', 'Ecology, Biodiversity & Conservation', 'environment')],
})

const currentEventsUnit = (): UnitSeed => ({
  slug: 'current-events', name: 'Current Events',
  description: 'National and international current affairs of examination relevance.',
  topics: [
    t('current-national', 'National Current Events', 'current-affairs'),
    t('current-tn', 'Tamil Nadu Current Events', 'current-affairs'),
  ],
})

const arithmeticUnit = (): UnitSeed => ({
  slug: 'arithmetic', name: 'Arithmetic & Quantitative Aptitude',
  topics: [
    t('percentages', 'Percentages', 'aptitude-percentages'),
    t('ratio-proportion', 'Ratio & Proportion', 'aptitude-ratio'),
    t('averages', 'Averages', 'aptitude-average'),
    t('number-system', 'Number System', 'aptitude-number-system'),
    t('time-work', 'Time & Work', 'aptitude-time-work'),
    t('time-speed-distance', 'Time, Speed & Distance', 'aptitude-time-speed-distance'),
    t('profit-loss', 'Profit & Loss', 'aptitude-profit-loss'),
    t('simple-interest', 'Simple & Compound Interest', 'aptitude-si-ci'),
    t('simplification', 'Simplification & Approximation', 'aptitude-simplification'),
    t('data-interpretation', 'Data Interpretation', 'aptitude-data-interpretation'),
  ],
})

const reasoningUnit = (): UnitSeed => ({
  slug: 'reasoning', name: 'Logical Reasoning & Mental Ability',
  topics: [
    t('series', 'Number & Letter Series', 'reasoning-series'),
    t('coding-decoding', 'Coding & Decoding', 'reasoning-coding'),
    t('blood-relations', 'Blood Relations', 'reasoning-blood-relations'),
    t('directions', 'Direction Sense', 'reasoning-directions'),
    t('syllogism', 'Syllogism', 'reasoning-syllogism'),
    t('puzzles-seating', 'Puzzles & Seating Arrangement', 'reasoning-puzzles'),
  ],
})

const measurementUnit = (): UnitSeed => ({
  slug: 'measurement', name: 'Measurement & Conversion',
  topics: [t('unit-conversion', 'Units, Conversion & Simple Machines', 'aptitude-measurement')],
})

const englishUnit = (): UnitSeed => ({
  slug: 'english', name: 'General English',
  topics: [
    t('grammar', 'Grammar: Tenses, Articles & Prepositions', 'english-grammar'),
    t('vocabulary', 'Vocabulary: Synonyms, Antonyms & Idioms', 'english-vocabulary'),
    t('comprehension', 'Reading Comprehension', 'english-comprehension'),
    t('error-spotting', 'Error Spotting & Sentence Correction', 'english-error-spotting'),
  ],
})

const computerUnit = (): UnitSeed => ({
  slug: 'computer', name: 'Computer Awareness',
  topics: [t('computer-basics', 'Computer Fundamentals & MS Office', 'computer-basics')],
})

const gsAptitudeSubjects = (): SubjectSeed[] => [
  { slug: 'gs', name: 'General Studies', icon: 'BookOpen', description: 'History, polity, geography, economy, science, environment and current events.', units: [
    historyUnitTn(), polityUnit(), tnPolityUnit(), geographyUnit(), economyUnit(), scienceUnit(), environmentUnit(), currentEventsUnit(),
  ] },
  { slug: 'aptitude', name: 'Aptitude & Mental Ability', icon: 'Calculator', description: 'Arithmetic, reasoning and measurement topics for the aptitude portion.', units: [
    arithmeticUnit(), reasoningUnit(), measurementUnit(),
  ] },
]

// ─── Exam definitions ────────────────────────────────────────────────────────
import { CUET_DOMAIN_SUBJECTS } from './cuet-domains'

export const EXAMS: ExamSeed[] = [
  // ═══ TAMIL NADU ═══
  {
    slug: 'tnpsc-group-1', name: 'TNPSC Group 1 Services Examination', shortName: 'TNPSC Group 1',
    authority: 'Tamil Nadu Public Service Commission', category: 'tamil-nadu', state: 'Tamil Nadu', featured: true,
    description: 'Flagship TNPSC recruitment for Deputy Collector, Deputy Superintendent of Police and other Group 1 posts, via Prelims, Mains and Interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Structured Prelims topic tree with original study notes, practice questions and tests for high-weightage areas. Full official-syllabus extraction (every subtopic) is in progress.',
    sourceRefs: [{ label: 'TNPSC official website', url: 'https://www.tnpsc.gov.in' }],
    stages: [
      {
        slug: 'prelims', name: 'Prelims (Objective)',
        paperNote: 'Single objective paper. 200 questions, 300 marks, 3 hours. No negative marking. Minimum qualifying marks apply per category.',
        pattern: {
          durationMin: 180, totalQuestions: 200, totalMarks: 300, negativeMark: 0,
          sections: [
            { name: 'General Studies', questions: 175, marks: 262.5 },
            { name: 'Aptitude & Mental Ability', questions: 25, marks: 37.5 },
          ],
        },
        subjects: gsAptitudeSubjects(),
      },
      { slug: 'mains', name: 'Mains (Descriptive)', paperNote: 'Descriptive written papers in General Studies (paper-wise structure as per latest TNPSC notification). Syllabus mapping for Mains is in progress.', subjects: [
        { slug: 'gs-mains', name: 'General Studies (Descriptive)', units: [
          { slug: 'descriptive-gs', name: 'Descriptive General Studies', topics: [
            t('mains-polity-essay', 'Polity & Governance (Descriptive)', 'polity-constitution'),
            t('mains-history-essay', 'History & National Movement (Descriptive)', 'history-national-movement'),
            t('mains-economy-essay', 'Economy & Development (Descriptive)', 'economy-basics'),
          ] },
        ] },
      ] },
      { slug: 'interview', name: 'Interview & Records', paperNote: 'Personality test and record verification for candidates clearing Mains.', subjects: [] },
    ],
  },
  {
    slug: 'tnpsc-group-2-2a', name: 'TNPSC Group 2 & Group 2A Services (CCSE-II)', shortName: 'TNPSC Group 2/2A',
    authority: 'Tamil Nadu Public Service Commission', category: 'tamil-nadu', state: 'Tamil Nadu', featured: true,
    description: 'Combined Civil Services Examination II for Interview posts (Group 2) and non-interview posts (Group 2A) such as Deputy Commercial Tax Officer, Sub Registrar and Municipal Commissioner.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Prelims topic tree mirrors Group 1 General Studies + Aptitude pattern. Notes, questions and tests available for core topics.',
    sourceRefs: [{ label: 'TNPSC official website', url: 'https://www.tnpsc.gov.in' }],
    stages: [
      {
        slug: 'prelims', name: 'Prelims (Objective)',
        paperNote: 'Single objective paper. 200 questions, 300 marks, 3 hours. No negative marking.',
        pattern: {
          durationMin: 180, totalQuestions: 200, totalMarks: 300, negativeMark: 0,
          sections: [
            { name: 'General Studies', questions: 175, marks: 262.5 },
            { name: 'Aptitude & Mental Ability', questions: 25, marks: 37.5 },
          ],
        },
        subjects: gsAptitudeSubjects(),
      },
      { slug: 'mains', name: 'Mains (Interview posts only)', paperNote: 'Descriptive paper(s) for Group 2 interview-post candidates only.', subjects: [] },
    ],
  },
  {
    slug: 'tnpsc-group-4', name: 'TNPSC Group 4 (CCSE-IV)', shortName: 'TNPSC Group 4',
    authority: 'Tamil Nadu Public Service Commission', category: 'tamil-nadu', state: 'Tamil Nadu', featured: true,
    description: 'Combined Civil Services Examination IV for VAO, Junior Assistant, Typist and other Group 4 posts. Single OMR-based examination.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Part A (Tamil eligibility) and Part B (General Studies + Aptitude) mapped at topic level. Notes/questions available for Part B core topics; Tamil-eligibility material is being prepared.',
    sourceRefs: [{ label: 'TNPSC official website', url: 'https://www.tnpsc.gov.in' }],
    stages: [
      {
        slug: 'written', name: 'Written Examination (Single Paper)',
        paperNote: 'Single paper, 200 questions, 300 marks, 3 hours: Part A Tamil Eligibility-cum-Scoring Test (100 Q, 150 marks) + Part B General Studies (75 Q) and Aptitude (25 Q) (100 Q, 150 marks). No negative marking.',
        pattern: {
          durationMin: 180, totalQuestions: 200, totalMarks: 300, negativeMark: 0,
          sections: [
            { name: 'Part A: Tamil Eligibility & Scoring', questions: 100, marks: 150 },
            { name: 'Part B: General Studies', questions: 75, marks: 112.5 },
            { name: 'Part B: Aptitude & Mental Ability', questions: 25, marks: 37.5 },
          ],
        },
        subjects: [
          { slug: 'tamil-eligibility', name: 'Part A: Tamil Eligibility-cum-Scoring', icon: 'Languages', units: [
            { slug: 'tamil-grammar', name: 'Tamil Grammar & Usage', topics: [
              t('tamil-grammar-basics', 'இலக்கணம் — Grammar Basics'),
              t('tamil-vocab', 'சொற்றொடர் / Vocabulary'),
            ] },
          ] },
          { slug: 'gs-aptitude', name: 'Part B: General Studies & Aptitude', icon: 'BookOpen', units: [
            historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit(),
            { slug: 'aptitude-b', name: 'Aptitude & Mental Ability', topics: arithmeticUnit().topics.slice(0, 6).concat(reasoningUnit().topics.slice(0, 3)) },
          ] },
        ],
      },
    ],
  },
  {
    slug: 'tnusrb-constable', name: 'TNUSRB Police Constable (Grade II) Recruitment', shortName: 'TNUSRB Constable',
    authority: 'Tamil Nadu Uniformed Services Recruitment Board', category: 'tamil-nadu', state: 'Tamil Nadu',
    description: 'Recruitment of Police Constables Grade II for the Tamil Nadu Police via written examination, physical measurement/endurance test and viva-voce.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Topic tree started with shared General Studies content. TNUSRB-specific syllabus verification pending.',
    sourceRefs: [{ label: 'TNUSRB official website', url: 'https://www.tnusrb.tn.gov.in' }],
    stages: [
      { slug: 'written', name: 'Written Examination', paperNote: 'Objective paper covering General Knowledge, Psychology and (for open candidates) Tamil language eligibility, plus physical tests and viva-voce in later stages. Verify weightage in the latest notification.', subjects: [
        { slug: 'gk', name: 'General Knowledge', units: [historyUnitTn(), polityUnit(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'psychology', name: 'Psychology (Reasoning & Aptitude)', units: [reasoningUnit(), { slug: 'arith-short', name: 'Basic Arithmetic', topics: arithmeticUnit().topics.slice(0, 5) }] },
      ] },
      { slug: 'physical', name: 'PMT / PET & Viva-voce', paperNote: 'Physical measurement, endurance test and interview for qualified candidates.', subjects: [] },
    ],
  },
  {
    slug: 'tnusrb-si', name: 'TNUSRB Sub-Inspector of Police (Taluk & AR)', shortName: 'TNUSRB SI',
    authority: 'Tamil Nadu Uniformed Services Recruitment Board', category: 'tamil-nadu', state: 'Tamil Nadu',
    description: 'Recruitment of Sub-Inspectors for Taluk and Armed Reserve police through written examination, physical tests, viva-voce and special marks.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Shares General Knowledge / Psychology paper structure with TNUSRB recruitment exams. Detailed syllabus verification pending.',
    sourceRefs: [{ label: 'TNUSRB official website', url: 'https://www.tnusrb.tn.gov.in' }],
    stages: [
      { slug: 'written', name: 'Written Examination', paperNote: 'Main written examination (General Knowledge, Psychology, Tamil eligibility) followed by physical and viva stages.', subjects: [
        { slug: 'gk', name: 'General Knowledge', units: [historyUnitTn(), polityUnit(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'psychology', name: 'Psychology (Reasoning & Aptitude)', units: [reasoningUnit(), arithmeticUnit()] },
      ] },
      { slug: 'physical-viva', name: 'PET / PMT & Viva-voce', subjects: [] },
    ],
  },
  {
    slug: 'tntet', name: 'Tamil Nadu Teacher Eligibility Test (TN TET)', shortName: 'TN TET',
    authority: 'Teachers Recruitment Board, Tamil Nadu', category: 'tamil-nadu', state: 'Tamil Nadu',
    description: 'State-level teacher eligibility test conducted by TRB Tamil Nadu: Paper I (Classes I–V) and Paper II (Classes VI–VIII).',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Paper structure recorded; topic-level material under preparation.',
    sourceRefs: [{ label: 'TRB Tamil Nadu', url: 'https://trb.tn.gov.in' }],
    stages: [
      { slug: 'paper-1', name: 'Paper I (Classes I–V)', paperNote: 'Child Development & Pedagogy, Language I (Tamil), Language II (English), Mathematics and Environmental Studies — 150 questions, 150 marks, 2.5 hours, no negative marking.', subjects: [
        { slug: 'cdp', name: 'Child Development & Pedagogy', units: [{ slug: 'cdp-core', name: 'Core Concepts', topics: [t('cdp-development', 'Child Development & Learning')] }] },
        { slug: 'math-1', name: 'Mathematics', units: [{ slug: 'math-primary', name: 'Primary Mathematics', topics: arithmeticUnit().topics.slice(0, 4) }] },
        { slug: 'evs', name: 'Environmental Studies', units: [{ slug: 'evs-core', name: 'EVS Concepts', topics: [t('evs-environment', 'Environment & Ecology', 'environment')] }] },
      ] },
      { slug: 'paper-2', name: 'Paper II (Classes VI–VIII)', paperNote: 'Child Development & Pedagogy, Language I, Language II and Mathematics & Science or Social Studies — 150 questions, 2.5 hours.', subjects: [
        { slug: 'cdp-2', name: 'Child Development & Pedagogy', units: [{ slug: 'cdp-core-2', name: 'Core Concepts', topics: [t('cdp-development-2', 'Child Development & Learning')] }] },
      ] },
    ],
  },

  // ═══ UPSC & CENTRAL ═══
  {
    slug: 'upsc-cse', name: 'UPSC Civil Services Examination', shortName: 'UPSC CSE',
    authority: 'Union Public Service Commission', category: 'upsc-central', featured: true,
    description: 'Premier central recruitment for IAS, IPS, IFS and other Group A services through Prelims (objective), Mains (written) and Personality Test (Interview).',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Prelims GS Paper 1 and CSAT mapped to topic level with original notes, practice questions and negative-marking-aware tests. Optional-subject and Mains mapping pending.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      {
        slug: 'prelims-gs1', name: 'Prelims — General Studies Paper I',
        paperNote: '100 questions, 200 marks, 2 hours. Negative marking: 1/3rd of marks (0.66) per wrong answer. Serves as screening for Mains.',
        pattern: {
          durationMin: 120, totalQuestions: 100, totalMarks: 200, negativeMark: 0.66,
          sections: [{ name: 'General Studies Paper I', questions: 100, marks: 200 }],
        },
        subjects: [
          { slug: 'gs1', name: 'General Studies', icon: 'BookOpen', units: [
            historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), environmentUnit(), currentEventsUnit(),
            { slug: 'world-history-geo', name: 'World History & Geography', topics: [t('world-geo', 'World Geography', 'geography-world')] },
          ] },
        ],
      },
      {
        slug: 'prelims-csat', name: 'Prelims — CSAT Paper II',
        paperNote: '80 questions, 200 marks, 2 hours. Qualifying: 33%. Negative marking 0.83 per wrong answer.',
        pattern: {
          durationMin: 120, totalQuestions: 80, totalMarks: 200, negativeMark: 0.83, qualifying: '33% qualifying (Paper II)',
          sections: [{ name: 'Comprehension, Reasoning & Numeracy', questions: 80, marks: 200 }],
        },
        subjects: [
          { slug: 'comprehension-reasoning', name: 'Comprehension & Reasoning', icon: 'Brain', units: [
            { slug: 'english-comp', name: 'Comprehension & Interpersonal Skills', topics: englishUnit().topics },
            reasoningUnit(),
          ] },
          { slug: 'basic-numeracy', name: 'Basic Numeracy', icon: 'Calculator', units: [arithmeticUnit()] },
        ],
      },
      { slug: 'mains', name: 'Mains (Written — 9 papers)', paperNote: 'Essay, GS I–IV, two optional-subject papers and two qualifying language papers. Mapping in progress.', subjects: [] },
      { slug: 'interview', name: 'Personality Test', paperNote: '275-mark personality test.', subjects: [] },
    ],
  },
  {
    slug: 'upsc-ifs', name: 'Indian Forest Service Examination', shortName: 'UPSC IFS',
    authority: 'Union Public Service Commission', category: 'upsc-central', featured: true,
    description: 'Recruitment for the Indian Forest Service. Prelims is shared with Civil Services (with qualifying cut-off); Mains covers Forestry and optional subjects.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Prelims preparation is shared with UPSC CSE GS Paper 1. Forestry Mains mapping pending.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims (shared with CSE)', paperNote: 'Same GS Paper 1 and CSAT as Civil Services Prelims; separate cut-off for IFS.', subjects: [
        { slug: 'gs1-ifs', name: 'General Studies Paper I', icon: 'BookOpen', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), environmentUnit()] },
      ] },
      { slug: 'mains', name: 'Mains (Forestry + Optional)', paperNote: 'General English, General Knowledge, Forestry and optional subject papers. Mapping pending.', subjects: [] },
    ],
  },
  {
    slug: 'ies-iss', name: 'Indian Economic Service & Indian Statistical Service Examination', shortName: 'IES/ISS',
    authority: 'Union Public Service Commission', category: 'upsc-central',
    description: 'Specialist officer recruitment for the Indian Economic Service and Indian Statistical Service for postgraduates in Economics/Statistics and related fields.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Specialist examination — subject papers require postgraduate-level Economics/Statistics. Structure recorded; topic mapping pending.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      { slug: 'written', name: 'Written Examination', paperNote: 'General English, General Studies plus subject-specific papers (Economics/Statistics).', subjects: [
        { slug: 'general-papers', name: 'General Papers', units: [
          { slug: 'gs-ies', name: 'General Studies', topics: [t('ies-gs', 'General Studies', 'polity-constitution')] },
          { slug: 'english-ies', name: 'General English', topics: englishUnit().topics },
        ] as unknown as UnitSeed[] },
      ] },
    ],
  },
  {
    slug: 'upsc-epfo', name: 'UPSC EPFO Enforcement Officer / Accounts Officer', shortName: 'UPSC EPFO EO/AO',
    authority: 'Union Public Service Commission', category: 'upsc-central',
    description: 'Recruitment of Enforcement Officers / Accounts Officers for the Employees\' Provident Fund Organisation via a single written examination and interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'General studies-oriented recruitment test. Topic tree pending; shares core GS content with other exams.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      { slug: 'written', name: 'Written Examination (Recruitment Test)', paperNote: 'Objective test covering General English, Indian Culture & Freedom Struggle, Polity & Economy, General Science, Accounting, Social Security and Labour Laws, Computer awareness and Current Affairs.', subjects: [
        { slug: 'gs-epfo', name: 'General Studies & Aptitude', units: [polityUnit(), economyUnit(), scienceUnit(), currentEventsUnit(), computerUnit()] },
      ] },
    ],
  },

  // ═══ SSC ═══
  {
    slug: 'ssc-cgl', name: 'SSC Combined Graduate Level Examination', shortName: 'SSC CGL',
    authority: 'Staff Selection Commission', category: 'ssc', featured: true,
    description: 'Major SSC recruitment for Group B and C posts in ministries and departments via Tier 1 (objective) and Tier 2 (objective, with skill tests where applicable).',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Tier 1 fully mapped with original questions and adaptive tests. Tier 2 modules mapping in progress.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      {
        slug: 'tier-1', name: 'Tier 1 (Objective)',
        paperNote: '100 questions, 200 marks, 60 minutes. Four equal sections. Negative marking: 0.50 per wrong answer.',
        pattern: {
          durationMin: 60, totalQuestions: 100, totalMarks: 200, negativeMark: 0.5,
          sections: [
            { name: 'General Intelligence & Reasoning', questions: 25, marks: 50 },
            { name: 'General Awareness', questions: 25, marks: 50 },
            { name: 'Quantitative Aptitude', questions: 25, marks: 50 },
            { name: 'English Comprehension', questions: 25, marks: 50 },
          ],
        },
        subjects: [
          { slug: 'reasoning', name: 'General Intelligence & Reasoning', icon: 'Brain', units: [reasoningUnit()] },
          { slug: 'ga', name: 'General Awareness', icon: 'Globe', units: [
            { slug: 'ga-static', name: 'Static & Current Awareness', topics: [
              t('ga-ancient', 'Ancient India', 'history-ancient'), t('ga-modern', 'Modern India', 'history-modern'),
              t('ga-polity', 'Indian Polity', 'polity-constitution'), t('ga-geo', 'Geography', 'geography-india'),
              t('ga-economy', 'Economy', 'economy-basics'), t('ga-physics', 'Physics', 'science-physics'),
              t('ga-chem', 'Chemistry', 'science-chemistry'), t('ga-bio', 'Biology', 'science-biology'),
              t('ga-current', 'Current Affairs', 'current-affairs'), t('ga-computer', 'Computer Basics', 'computer-basics'),
            ] },
          ] },
          { slug: 'quant', name: 'Quantitative Aptitude', icon: 'Calculator', units: [arithmeticUnit()] },
          { slug: 'english', name: 'English Comprehension', icon: 'Languages', units: [englishUnit()] },
        ],
      },
      { slug: 'tier-2', name: 'Tier 2 (Objective + Skill Tests)', paperNote: 'Paper 1 (Session I & II) covers Mathematical Abilities, Reasoning, English, General Awareness, Computer Knowledge and a Data Entry Speed Test; separate papers for JSO/AAO. Mapping in progress.', subjects: [
        { slug: 'tier2-math', name: 'Mathematical Abilities', units: [arithmeticUnit()] },
        { slug: 'tier2-reasoning', name: 'Reasoning & General Intelligence', units: [reasoningUnit()] },
        { slug: 'tier2-english', name: 'English Language & Comprehension', units: [englishUnit()] },
        { slug: 'tier2-computer', name: 'Computer Knowledge Module', units: [computerUnit()] },
      ] },
    ],
  },
  {
    slug: 'ssc-chsl', name: 'SSC Combined Higher Secondary Level (10+2)', shortName: 'SSC CHSL',
    authority: 'Staff Selection Commission', category: 'ssc', featured: true,
    description: 'Recruitment for LDC, JSA, DEO and postal/sorting assistant posts for 10+2 passed candidates via Tier 1 objective and Tier 2 tests.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Tier 1 shares the SSC CGL subject structure at 10+2 difficulty. Notes and questions attached to core topics.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      {
        slug: 'tier-1', name: 'Tier 1 (Objective)',
        paperNote: '100 questions, 200 marks, 60 minutes, negative marking 0.50.',
        pattern: {
          durationMin: 60, totalQuestions: 100, totalMarks: 200, negativeMark: 0.5,
          sections: [
            { name: 'General Intelligence', questions: 25, marks: 50 },
            { name: 'General Awareness', questions: 25, marks: 50 },
            { name: 'Quantitative Aptitude', questions: 25, marks: 50 },
            { name: 'English Language', questions: 25, marks: 50 },
          ],
        },
        subjects: [
          { slug: 'reasoning', name: 'General Intelligence', icon: 'Brain', units: [reasoningUnit()] },
          { slug: 'ga', name: 'General Awareness', icon: 'Globe', units: [
            { slug: 'ga-static', name: 'Static & Current Awareness', topics: [
              t('ga-history', 'History', 'history-modern'), t('ga-polity', 'Polity', 'polity-constitution'),
              t('ga-geo', 'Geography', 'geography-india'), t('ga-science', 'General Science', 'science-physics'),
              t('ga-current', 'Current Affairs', 'current-affairs'),
            ] },
          ] },
          { slug: 'quant', name: 'Quantitative Aptitude', icon: 'Calculator', units: [arithmeticUnit()] },
          { slug: 'english', name: 'English Language', icon: 'Languages', units: [englishUnit()] },
        ],
      },
      { slug: 'tier-2', name: 'Tier 2', paperNote: 'Objective sections plus skill/typing tests.', subjects: [] },
    ],
  },
  {
    slug: 'ssc-mts', name: 'SSC Multi-Tasking (Non-Technical) Staff Examination', shortName: 'SSC MTS',
    authority: 'Staff Selection Commission', category: 'ssc',
    description: 'Recruitment for Multi-Tasking Staff and Havaldar posts via computer-based examination (Session 1 & Session 2) and physical tests for Havaldar.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Session-based pattern recorded at a high level; topic mapping shares SSC core content.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Examination', paperNote: 'Session 1: Numerical & Mathematical Ability, Reasoning & General Intelligence. Session 2: General Awareness and English (negative marking applies in Session 2). Verify the latest notification for exact structure.', subjects: [
        { slug: 'session-1', name: 'Session 1', units: [
          { slug: 'math-mts', name: 'Numerical & Mathematical Ability', topics: arithmeticUnit().topics.slice(0, 6) },
          { slug: 'reasoning-mts', name: 'Reasoning & General Intelligence', topics: reasoningUnit().topics },
        ] as unknown as UnitSeed[] },
        { slug: 'session-2', name: 'Session 2', units: [
          { slug: 'ga-mts', name: 'General Awareness', topics: [t('ga-history', 'History', 'history-modern'), t('ga-polity', 'Polity', 'polity-constitution'), t('ga-science', 'Science', 'science-physics'), t('ga-current', 'Current Affairs', 'current-affairs')] },
          { slug: 'english-mts', name: 'English Language', topics: englishUnit().topics },
        ] as unknown as UnitSeed[] },
      ] },
    ],
  },
  {
    slug: 'ssc-cpo', name: 'SSC CPO — SI in Delhi Police & CAPF', shortName: 'SSC CPO',
    authority: 'Staff Selection Commission', category: 'ssc',
    description: 'Recruitment of Sub-Inspectors in Delhi Police and Central Armed Police Forces via Paper 1, PET/PST and Paper 2 (English).',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Paper 1 structure recorded; shares SSC core content.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      { slug: 'paper-1', name: 'Paper 1 (Objective)', paperNote: '200 questions, 200 marks, 2 hours: GI&R 50, GK 50, Quant 50, English 50. Negative marking 0.25.', subjects: [
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
        { slug: 'gk', name: 'General Knowledge & Awareness', units: [polityUnit(), historyUnitTn(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'quant', name: 'Quantitative Aptitude', units: [arithmeticUnit()] },
        { slug: 'english', name: 'English Comprehension', units: [englishUnit()] },
      ] },
      { slug: 'pet-pst', name: 'PET / PST & Paper 2', paperNote: 'Physical standards/endurance followed by Paper 2 (English language & comprehension).', subjects: [] },
    ],
  },
  {
    slug: 'ssc-gd', name: 'SSC GD Constable (General Duty)', shortName: 'SSC GD',
    authority: 'Staff Selection Commission', category: 'ssc',
    description: 'Recruitment of Constables (General Duty) in BSF, CISF, CRPF, SSB, ITBP, AR, SSF and Rifleman (GD) in Assam Rifles via CBT, PET/PST and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT structure recorded; shares SSC core content at matriculation level.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: '160 questions, 160 marks, 60 minutes: GK 40, Elementary Math 20, Reasoning 20, English/Hindi 40? — structure as per latest notification; negative marking 0.50.', subjects: [
        { slug: 'gk', name: 'General Knowledge & Awareness', units: [polityUnit(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'math', name: 'Elementary Mathematics', units: [{ slug: 'math-gd', name: 'Elementary Math', topics: arithmeticUnit().topics.slice(0, 5) }] },
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
      ] },
      { slug: 'pet-pst', name: 'PET / PST & Medical', subjects: [] },
    ],
  },
  {
    slug: 'ssc-steno', name: 'SSC Stenographer Grade C & D Examination', shortName: 'SSC Stenographer',
    authority: 'Staff Selection Commission', category: 'ssc',
    description: 'Recruitment of Stenographers Grade C (Group B) and Grade D (Group C) via CBT and skill test in stenography.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT structure recorded; shares SSC core content.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: '200 questions, 200 marks, 2 hours: GI&R 50, General Awareness 50, English 100. Negative marking 0.25.', subjects: [
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
        { slug: 'ga', name: 'General Awareness', units: [polityUnit(), historyUnitTn(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'english', name: 'English Language & Comprehension', units: [englishUnit()] },
      ] },
      { slug: 'skill', name: 'Stenography Skill Test', subjects: [] },
    ],
  },
  {
    slug: 'ssc-selection-post', name: 'SSC Selection Post Examination', shortName: 'SSC Selection Post',
    authority: 'Staff Selection Commission', category: 'ssc',
    description: 'Phase-wise direct recruitment for selection posts at matriculation, higher-secondary and graduate levels.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Level-wise CBT structure recorded; shares SSC core content.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Examination', paperNote: 'Separate papers for Matriculation, Higher Secondary and Graduate levels; 100–120 questions as per level. Negative marking 0.50.', subjects: [
        { slug: 'grad-level', name: 'Graduate Level Paper', units: [reasoningUnit(), arithmeticUnit(), englishUnit(), { slug: 'ga-sp', name: 'General Awareness', topics: [t('ga-history', 'History', 'history-modern'), t('ga-polity', 'Polity', 'polity-constitution'), t('ga-science', 'Science', 'science-biology'), t('ga-current', 'Current Affairs', 'current-affairs')] }] },
      ] },
    ],
  },

  // ═══ BANKING & INSURANCE ═══
  {
    slug: 'ibps-po', name: 'IBPS Probationary Officer / Management Trainee', shortName: 'IBPS PO',
    authority: 'Institute of Banking Personnel Selection', category: 'banking-insurance', featured: true,
    description: 'Recruitment of Probationary Officers / Management Trainees in participating public-sector banks via Prelims, Mains and Interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Prelims fully mapped with sectional-timing-aware tests and original questions. Mains (including descriptive paper) mapping in progress.',
    sourceRefs: [{ label: 'IBPS official website', url: 'https://www.ibps.in' }],
    stages: [
      {
        slug: 'prelims', name: 'Prelims (Objective)',
        paperNote: '100 questions, 100 marks, 60 minutes with sectional timing (English 35Q/20min, Quantitative Aptitude 35Q/20min, Reasoning 35Q/20min). Negative marking 0.25.',
        pattern: {
          durationMin: 60, totalQuestions: 100, totalMarks: 100, negativeMark: 0.25,
          sections: [
            { name: 'English Language', questions: 35, marks: 35, durationMin: 20 },
            { name: 'Quantitative Aptitude', questions: 35, marks: 35, durationMin: 20 },
            { name: 'Reasoning Ability', questions: 35, marks: 35, durationMin: 20 },
          ],
        },
        subjects: [
          { slug: 'english', name: 'English Language', icon: 'Languages', units: [englishUnit()] },
          { slug: 'quant', name: 'Quantitative Aptitude', icon: 'Calculator', units: [
            { slug: 'arith-bank', name: 'Arithmetic & Calculation', topics: [
              t('simplification', 'Simplification & Approximation', 'aptitude-simplification'),
              t('number-series-q', 'Number System & Series', 'aptitude-number-system'),
              t('percentages', 'Percentages', 'aptitude-percentages'),
              t('ratio', 'Ratio & Proportion', 'aptitude-ratio'),
              t('average', 'Averages', 'aptitude-average'),
              t('profit-loss', 'Profit & Loss', 'aptitude-profit-loss'),
              t('si-ci', 'Simple & Compound Interest', 'aptitude-si-ci'),
              t('time-work', 'Time & Work', 'aptitude-time-work'),
              t('tsd', 'Time, Speed & Distance', 'aptitude-time-speed-distance'),
              t('di', 'Data Interpretation', 'aptitude-data-interpretation'),
              t('quadratic', 'Quadratic Equations', 'math-quadratic'),
            ] },
          ] },
          { slug: 'reasoning', name: 'Reasoning Ability', icon: 'Brain', units: [reasoningUnit()] },
        ],
      },
      { slug: 'mains', name: 'Mains (Objective + Descriptive)', paperNote: 'Objective paper: English, Data Analysis & Interpretation, Reasoning & Computer Aptitude, General/Banking/Economy Awareness; plus a descriptive English paper and Interview. Mapping in progress.', subjects: [
        { slug: 'banking-awareness', name: 'General / Banking / Economy Awareness', icon: 'Landmark', units: [
          { slug: 'banking-core', name: 'Banking & Economy', topics: [
            t('banking-system', 'Banking System & RBI', 'economy-banking'),
            t('banking-terms', 'Banking Terminology & Products', 'banking-awareness'),
            t('economy-current', 'Economy & Current Affairs', 'current-affairs'),
          ] },
        ] },
        { slug: 'computer-apt', name: 'Computer Aptitude', icon: 'Monitor', units: [computerUnit()] },
      ] },
    ],
  },
  {
    slug: 'ibps-clerk', name: 'IBPS Clerk (Customer Service Associate)', shortName: 'IBPS Clerk',
    authority: 'Institute of Banking Personnel Selection', category: 'banking-insurance',
    description: 'Recruitment of Customer Service Associates (Clerks) in participating banks via Prelims and Mains; no interview for clerical cadre.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Prelims structure same as IBPS PO Prelims; shares question bank and tests.',
    sourceRefs: [{ label: 'IBPS official website', url: 'https://www.ibps.in' }],
    stages: [
      {
        slug: 'prelims', name: 'Prelims (Objective)',
        paperNote: '100 questions, 100 marks, 60 minutes with sectional timing. Negative marking 0.25.',
        pattern: {
          durationMin: 60, totalQuestions: 100, totalMarks: 100, negativeMark: 0.25,
          sections: [
            { name: 'English Language', questions: 30, marks: 30, durationMin: 20 },
            { name: 'Numerical Ability', questions: 35, marks: 35, durationMin: 20 },
            { name: 'Reasoning Ability', questions: 35, marks: 35, durationMin: 20 },
          ],
        },
        subjects: [
          { slug: 'english', name: 'English Language', icon: 'Languages', units: [englishUnit()] },
          { slug: 'quant', name: 'Numerical Ability', icon: 'Calculator', units: [arithmeticUnit()] },
          { slug: 'reasoning', name: 'Reasoning Ability', icon: 'Brain', units: [reasoningUnit()] },
        ],
      },
      { slug: 'mains', name: 'Mains', paperNote: 'General English, Quantitative Aptitude, Reasoning & Computer Aptitude and General/Banking Awareness.', subjects: [
        { slug: 'banking-mains', name: 'General / Banking Awareness', units: [
          { slug: 'banking-core', name: 'Banking & Economy', topics: [t('banking-system', 'Banking System & RBI', 'economy-banking'), t('banking-terms', 'Banking Terminology', 'banking-awareness')] },
        ] },
      ] },
    ],
  },
  {
    slug: 'ibps-so', name: 'IBPS Specialist Officer (IT, Agriculture, Marketing, HR, Law)', shortName: 'IBPS SO',
    authority: 'Institute of Banking Personnel Selection', category: 'banking-insurance',
    description: 'Recruitment of Specialist Officers across participating banks: IT Officer, Agricultural Officer, Marketing Officer, HR Officer and Law Officer.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Prelims structure recorded; professional-knowledge papers are subject-specific and mapping pending.',
    sourceRefs: [{ label: 'IBPS official website', url: 'https://www.ibps.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'English, Reasoning and Quantitative Aptitude (professional subjects come in Mains; pattern varies by post).', subjects: [
        { slug: 'english', name: 'English Language', units: [englishUnit()] },
        { slug: 'reasoning', name: 'Reasoning Ability', units: [reasoningUnit()] },
        { slug: 'quant', name: 'Quantitative Aptitude', units: [arithmeticUnit()] },
      ] },
      { slug: 'mains', name: 'Mains (Professional Knowledge)', paperNote: 'Professional knowledge paper in the respective discipline.', subjects: [] },
    ],
  },
  {
    slug: 'ibps-rrb', name: 'IBPS RRB — Officer Scale I & Office Assistant', shortName: 'IBPS RRB',
    authority: 'Institute of Banking Personnel Selection', category: 'banking-insurance',
    description: 'Regional Rural Bank recruitment: Officer Scale I (PO) and Office Assistant (Clerk) via Prelims and Mains conducted region-wise.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Prelims structure recorded; shares IBPS-style content.',
    sourceRefs: [{ label: 'IBPS official website', url: 'https://www.ibps.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Officer Scale I: Reasoning 40 + Quant 40, 45 minutes. Office Assistant: Reasoning 40 + Numerical Ability 40, 45 minutes. Negative marking 0.25.', subjects: [
        { slug: 'reasoning', name: 'Reasoning Ability', units: [reasoningUnit()] },
        { slug: 'quant', name: 'Quantitative / Numerical Ability', units: [arithmeticUnit()] },
      ] },
      { slug: 'mains', name: 'Mains', paperNote: 'Reasoning, Quantitative Aptitude/Numerical Ability, English/Hindi, Computer Knowledge and General Awareness.', subjects: [
        { slug: 'computer', name: 'Computer Knowledge', units: [computerUnit()] },
        { slug: 'ga', name: 'General Awareness', units: [
          { slug: 'banking-core', name: 'Banking & Economy', topics: [t('banking-system', 'Banking System & RBI', 'economy-banking'), t('banking-terms', 'Banking Terminology', 'banking-awareness')] },
        ] },
      ] },
    ],
  },
  {
    slug: 'sbi-po', name: 'SBI Probationary Officers Examination', shortName: 'SBI PO',
    authority: 'State Bank of India', category: 'banking-insurance', featured: true,
    description: 'SBI\'s own Probationary Officer recruitment: Prelims, Mains (with descriptive paper), psychometric/group exercises and interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Prelims fully mapped; Mains data-interpretation emphasis reflected in topics.',
    sourceRefs: [{ label: 'SBI Careers', url: 'https://sbi.co.in/web/careers' }],
    stages: [
      {
        slug: 'prelims', name: 'Prelims (Objective)',
        paperNote: '100 questions, 100 marks, 60 minutes with sectional timing. Negative marking 0.25.',
        pattern: {
          durationMin: 60, totalQuestions: 100, totalMarks: 100, negativeMark: 0.25,
          sections: [
            { name: 'English Language', questions: 35, marks: 35, durationMin: 20 },
            { name: 'Quantitative Aptitude', questions: 35, marks: 35, durationMin: 20 },
            { name: 'Reasoning Ability', questions: 35, marks: 35, durationMin: 20 },
          ],
        },
        subjects: [
          { slug: 'english', name: 'English Language', icon: 'Languages', units: [englishUnit()] },
          { slug: 'quant', name: 'Quantitative Aptitude', icon: 'Calculator', units: [
            { slug: 'arith-bank', name: 'Arithmetic & Calculation', topics: [
              t('simplification', 'Simplification & Approximation', 'aptitude-simplification'),
              t('di', 'Data Interpretation', 'aptitude-data-interpretation'),
              t('percentages', 'Percentages', 'aptitude-percentages'),
              t('ratio', 'Ratio & Proportion', 'aptitude-ratio'),
              t('average', 'Averages', 'aptitude-average'),
              t('profit-loss', 'Profit & Loss', 'aptitude-profit-loss'),
              t('si-ci', 'Simple & Compound Interest', 'aptitude-si-ci'),
              t('time-work', 'Time & Work', 'aptitude-time-work'),
              t('tsd', 'Time, Speed & Distance', 'aptitude-time-speed-distance'),
              t('quadratic', 'Quadratic Equations', 'math-quadratic'),
            ] },
          ] },
          { slug: 'reasoning', name: 'Reasoning Ability', icon: 'Brain', units: [reasoningUnit()] },
        ],
      },
      { slug: 'mains', name: 'Mains (Objective + Descriptive)', paperNote: 'Reasoning & Computer Aptitude, Data Analysis & Interpretation, General/Economy/Banking Awareness, English Language + Descriptive test and psychometric/interview stages.', subjects: [
        { slug: 'banking-awareness', name: 'General / Economy / Banking Awareness', icon: 'Landmark', units: [
          { slug: 'banking-core', name: 'Banking & Economy', topics: [t('banking-system', 'Banking System & RBI', 'economy-banking'), t('banking-terms', 'Banking Terminology & Products', 'banking-awareness')] },
        ] },
      ] },
    ],
  },
  {
    slug: 'sbi-clerk', name: 'SBI Clerk (Junior Associate)', shortName: 'SBI Clerk',
    authority: 'State Bank of India', category: 'banking-insurance',
    description: 'SBI Junior Associate (Customer Support & Sales) recruitment via Prelims and Mains with state/circle-wise allocation.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Prelims structure same as IBPS Clerk; shares content.',
    sourceRefs: [{ label: 'SBI Careers', url: 'https://sbi.co.in/web/careers' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'English 30, Numerical Ability 35, Reasoning 35 — 100 questions, 1 hour, sectional timing, negative marking 0.25.', subjects: [
        { slug: 'english', name: 'English Language', units: [englishUnit()] },
        { slug: 'quant', name: 'Numerical Ability', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'Reasoning Ability', units: [reasoningUnit()] },
      ] },
      { slug: 'mains', name: 'Mains', paperNote: 'General English, Quantitative Aptitude, Reasoning & Computer Aptitude, General/Banking Awareness + local language test.', subjects: [
        { slug: 'computer', name: 'Computer Aptitude', units: [computerUnit()] },
      ] },
    ],
  },
  {
    slug: 'rbi-grade-b', name: 'RBI Grade B Officer Examination', shortName: 'RBI Grade B',
    authority: 'Reserve Bank of India', category: 'banking-insurance', featured: true,
    description: 'Reserve Bank of India officer recruitment: Phase 1 objective, Phase 2 (Economic & Social Issues, English writing, Finance & Management) and Interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Phase 1 mapped; Phase 2 specialist papers (ESI, F&M) mapping in progress with core banking/economy content.',
    sourceRefs: [{ label: 'RBI Opportunities', url: 'https://opportunities.rbi.org.in' }],
    stages: [
      {
        slug: 'phase-1', name: 'Phase 1 (Objective)',
        paperNote: '200 questions, 200 marks, 120 minutes: General Awareness 80, English 30, Quantitative Aptitude 30, Reasoning 60. Negative marking 0.25, sectional timing.',
        pattern: {
          durationMin: 120, totalQuestions: 200, totalMarks: 200, negativeMark: 0.25,
          sections: [
            { name: 'General Awareness', questions: 80, marks: 80, durationMin: 45 },
            { name: 'English Language', questions: 30, marks: 30, durationMin: 25 },
            { name: 'Quantitative Aptitude', questions: 30, marks: 30, durationMin: 25 },
            { name: 'Reasoning', questions: 60, marks: 60, durationMin: 60 },
          ],
        },
        subjects: [
          { slug: 'ga', name: 'General Awareness', icon: 'Globe', units: [
            { slug: 'ga-core', name: 'Awareness', topics: [t('banking-system', 'Banking System & RBI', 'economy-banking'), t('banking-terms', 'Banking Terminology', 'banking-awareness'), t('ga-current', 'Current Affairs', 'current-affairs'), t('ga-economy', 'Indian Economy', 'economy-basics')] },
          ] },
          { slug: 'english', name: 'English Language', units: [englishUnit()] },
          { slug: 'quant', name: 'Quantitative Aptitude', units: [arithmeticUnit()] },
          { slug: 'reasoning', name: 'Reasoning', units: [reasoningUnit()] },
        ],
      },
      { slug: 'phase-2', name: 'Phase 2 (ESI, English, F&M)', paperNote: 'Three papers: Economic & Social Issues, English (writing skills), Finance & Management — descriptive/objective mix.', subjects: [
        { slug: 'esi', name: 'Economic & Social Issues', units: [
          { slug: 'esi-core', name: 'Core Concepts', topics: [t('esi-economy', 'Indian Economy & Development', 'economy-basics'), t('esi-tn', 'Regional Economies', 'economy-tn')] },
        ] },
      ] },
    ],
  },
  {
    slug: 'rbi-assistant', name: 'RBI Assistant Examination', shortName: 'RBI Assistant',
    authority: 'Reserve Bank of India', category: 'banking-insurance',
    description: 'RBI Assistant recruitment via Prelims, Mains and Language Proficiency Test.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Prelims structure recorded; shares IBPS-style content.',
    sourceRefs: [{ label: 'RBI Opportunities', url: 'https://opportunities.rbi.org.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'English 30, Numerical Ability 35, Reasoning 35 — 100 questions, 1 hour, negative marking 0.25.', subjects: [
        { slug: 'english', name: 'English Language', units: [englishUnit()] },
        { slug: 'quant', name: 'Numerical Ability', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'Reasoning', units: [reasoningUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & LPT', paperNote: 'English, Quantitative Aptitude, Reasoning, Computer Knowledge and General Awareness, followed by language test.', subjects: [
        { slug: 'computer', name: 'Computer Knowledge', units: [computerUnit()] },
        { slug: 'ga', name: 'General Awareness', units: [{ slug: 'banking-core', name: 'Banking & Economy', topics: [t('banking-system', 'Banking System & RBI', 'economy-banking')] }] },
      ] },
    ],
  },
  {
    slug: 'nabard-grade-a', name: 'NABARD Grade A Officer Examination', shortName: 'NABARD Grade A',
    authority: 'National Bank for Agriculture and Rural Development', category: 'banking-insurance',
    description: 'NABARD Assistant Manager (Grade A) recruitment: Prelims, Mains with agriculture/rural-development emphasis, and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; agriculture and rural development modules pending.',
    sourceRefs: [{ label: 'NABARD official website', url: 'https://www.nabard.org' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Eight-section objective test including Reasoning, English, Computer, Quant, Decision Making, ARD, Current Affairs and ESI.', subjects: [
        { slug: 'quant-english-reasoning', name: 'Core Sections', units: [englishUnit(), arithmeticUnit(), reasoningUnit(), computerUnit()] },
        { slug: 'ard-esi', name: 'ARD, Current Affairs & ESI', units: [
          { slug: 'ard-core', name: 'Agriculture & Rural Development + ESI', topics: [t('ard-economy', 'Indian Economy & ESI', 'economy-basics'), t('ard-environment', 'Environment & Sustainability', 'environment')] },
        ] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'lic-aao', name: 'LIC Assistant Administrative Officer (AAO)', shortName: 'LIC AAO',
    authority: 'Life Insurance Corporation of India', category: 'banking-insurance',
    description: 'LIC AAO (Generalist and specialist streams) recruitment via Prelims, Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; insurance-specific modules pending. Verify latest LIC notification for exact pattern.',
    sourceRefs: [{ label: 'LIC India', url: 'https://licindia.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Reasoning, Quantitative Aptitude and English (English qualifying) with sectional timing.', subjects: [
        { slug: 'reasoning', name: 'Reasoning', units: [reasoningUnit()] },
        { slug: 'quant', name: 'Quantitative Aptitude', units: [arithmeticUnit()] },
        { slug: 'english', name: 'English Language', units: [englishUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', paperNote: 'Reasoning, Quant, GK (incl. insurance awareness) and English + Interview.', subjects: [
        { slug: 'ga', name: 'GK & Insurance Awareness', units: [{ slug: 'banking-core', name: 'Banking & Insurance Awareness', topics: [t('banking-terms', 'Banking & Insurance Terminology', 'banking-awareness')] }] },
      ] },
    ],
  },
  {
    slug: 'niacl-assistant', name: 'NIACL Assistant Examination', shortName: 'NIACL Assistant',
    authority: 'New India Assurance Company Limited', category: 'banking-insurance',
    description: 'The New India Assurance Company Assistant recruitment via Prelims, Mains and regional language test.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares banking/insurance core content.',
    sourceRefs: [{ label: 'The New India Assurance', url: 'https://www.newindia.co.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'English 30, Reasoning 35, Numerical Ability 35 — 100 questions, 1 hour.', subjects: [
        { slug: 'english', name: 'English Language', units: [englishUnit()] },
        { slug: 'reasoning', name: 'Reasoning', units: [reasoningUnit()] },
        { slug: 'quant', name: 'Numerical Ability', units: [arithmeticUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Language Test', subjects: [] },
    ],
  },

  // ═══ RAILWAYS ═══
  {
    slug: 'rrb-ntpc', name: 'RRB Non-Technical Popular Categories (NTPC)', shortName: 'RRB NTPC',
    authority: 'Railway Recruitment Boards', category: 'railways', featured: true,
    description: 'Graduate and undergraduate NTPC posts (Station Master, Goods Train Manager, Sr. Clerk, CA/TA etc.) via CBT 1, CBT 2 and skill/typing tests.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'CBT 1 fully mapped with notes, questions and tests. CBT 2 shares subjects at higher depth; mapping in progress.',
    sourceRefs: [{ label: 'Railway Recruitment Boards', url: 'https://www.rrbcdg.gov.in' }],
    stages: [
      {
        slug: 'cbt-1', name: 'CBT 1',
        paperNote: '100 questions, 100 marks, 90 minutes: General Awareness 40, Mathematics 30, General Intelligence & Reasoning 30. Negative marking 0.33.',
        pattern: {
          durationMin: 90, totalQuestions: 100, totalMarks: 100, negativeMark: 0.33,
          sections: [
            { name: 'General Awareness', questions: 40, marks: 40 },
            { name: 'Mathematics', questions: 30, marks: 30 },
            { name: 'General Intelligence & Reasoning', questions: 30, marks: 30 },
          ],
        },
        subjects: [
          { slug: 'ga', name: 'General Awareness', icon: 'Globe', units: [
            { slug: 'ga-core', name: 'Awareness', topics: [
              t('ga-modern', 'Modern India', 'history-modern'), t('ga-polity', 'Indian Polity', 'polity-constitution'),
              t('ga-geo', 'Geography', 'geography-india'), t('ga-economy', 'Economy', 'economy-basics'),
              t('ga-physics', 'Physics', 'science-physics'), t('ga-chem', 'Chemistry', 'science-chemistry'),
              t('ga-bio', 'Biology', 'science-biology'), t('ga-current', 'Current Affairs', 'current-affairs'),
              t('ga-computer', 'Computer Basics', 'computer-basics'),
            ] },
          ] },
          { slug: 'math', name: 'Mathematics', icon: 'Calculator', units: [arithmeticUnit()] },
          { slug: 'reasoning', name: 'General Intelligence & Reasoning', icon: 'Brain', units: [reasoningUnit()] },
        ],
      },
      { slug: 'cbt-2', name: 'CBT 2', paperNote: 'Level-specific CBT with same subjects at higher difficulty, followed by typing/skill tests where applicable.', subjects: [
        { slug: 'ga-2', name: 'General Awareness', units: [{ slug: 'ga-core', name: 'Awareness', topics: [t('ga-polity', 'Polity', 'polity-constitution'), t('ga-economy', 'Economy', 'economy-basics'), t('ga-current', 'Current Affairs', 'current-affairs')] }] },
        { slug: 'math-2', name: 'Mathematics', units: [arithmeticUnit()] },
        { slug: 'reasoning-2', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
      ] },
    ],
  },
  {
    slug: 'rrb-group-d', name: 'RRB Group D (Level 1) Recruitment', shortName: 'RRB Group D',
    authority: 'Railway Recruitment Cells / Railway Recruitment Boards', category: 'railways', featured: true,
    description: 'Level 1 posts (Track Maintainer, Pointsman, Assistant roles) via Computer Based Test followed by Physical Efficiency Test and document verification.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'CBT mapped at matriculation level using shared core content.',
    sourceRefs: [{ label: 'Railway Recruitment Boards', url: 'https://www.rrbcdg.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: '100 questions, 100 marks, 90 minutes: General Science 25, Mathematics 25, GI & Reasoning 30, Current Affairs 20. Negative marking 0.33.', subjects: [
        { slug: 'science', name: 'General Science', units: [scienceUnit(), environmentUnit()] },
        { slug: 'math', name: 'Mathematics', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
        { slug: 'current', name: 'Current Affairs', units: [currentEventsUnit()] },
      ] },
      { slug: 'pet', name: 'PET & Document Verification', subjects: [] },
    ],
  },
  {
    slug: 'rrb-alp', name: 'RRB Assistant Loco Pilot (ALP)', shortName: 'RRB ALP',
    authority: 'Railway Recruitment Boards', category: 'railways',
    description: 'Assistant Loco Pilot recruitment via CBT 1, CBT 2 (with Basic Science & Engineering) and Computer Based Aptitude Test.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT 1 structure recorded; technical/engineering modules pending.',
    sourceRefs: [{ label: 'Railway Recruitment Boards', url: 'https://www.rrbcdg.gov.in' }],
    stages: [
      { slug: 'cbt-1', name: 'CBT 1', paperNote: '75 questions, 75 marks, 60 minutes: Math 20, GI&R 25, General Science 20, Current Affairs 10. Negative marking 0.33.', subjects: [
        { slug: 'math', name: 'Mathematics', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
        { slug: 'science', name: 'General Science', units: [scienceUnit()] },
        { slug: 'current', name: 'Current Affairs', units: [currentEventsUnit()] },
      ] },
      { slug: 'cbt-2', name: 'CBT 2 + CBAT', paperNote: 'Basic Science & Engineering + trade syllabus, followed by Computer Based Aptitude Test.', subjects: [] },
    ],
  },
  {
    slug: 'rrb-technician', name: 'RRB Technician Recruitment (Grade I Signal & Grade III)', shortName: 'RRB Technician',
    authority: 'Railway Recruitment Boards', category: 'railways',
    description: 'Technician Grade I Signal and Technician Grade III recruitment via CBT followed by document verification and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; trade-specific modules pending.',
    sourceRefs: [{ label: 'Railway Recruitment Boards', url: 'https://www.rrbcdg.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: 'Objective test: General Awareness, Mathematics, General Intelligence & Reasoning, General Science (weightage varies by grade).', subjects: [
        { slug: 'math', name: 'Mathematics', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
        { slug: 'science', name: 'General Science', units: [scienceUnit()] },
      ] },
    ],
  },
  {
    slug: 'rpf-constable', name: 'RPF Constable Recruitment', shortName: 'RPF Constable',
    authority: 'Railway Protection Force / Railway Recruitment Boards', category: 'railways',
    description: 'Constable recruitment in the Railway Protection Force via CBT, Physical Efficiency Test, Physical Measurement Test and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT structure recorded; shares railway-level general content.',
    sourceRefs: [{ label: 'Railway Recruitment Boards', url: 'https://www.rrbcdg.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: '120 questions, 120 marks, 90 minutes: General Awareness 50, Arithmetic 35, General Intelligence & Reasoning 35. Negative marking 0.33.', subjects: [
        { slug: 'ga', name: 'General Awareness', units: [polityUnit(), historyUnitTn(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'arith', name: 'Arithmetic', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
      ] },
      { slug: 'pet-pmt', name: 'PET / PMT & Medical', subjects: [] },
    ],
  },
  {
    slug: 'rpf-si', name: 'RPF Sub-Inspector Recruitment', shortName: 'RPF SI',
    authority: 'Railway Protection Force / Railway Recruitment Boards', category: 'railways',
    description: 'Sub-Inspector recruitment in the Railway Protection Force via CBT and physical tests.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT structure recorded; shares railway-level general content.',
    sourceRefs: [{ label: 'Railway Recruitment Boards', url: 'https://www.rrbcdg.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: '120 questions, 120 marks, 90 minutes: General Awareness 50, Arithmetic 35, General Intelligence & Reasoning 35. Negative marking 0.33.', subjects: [
        { slug: 'ga', name: 'General Awareness', units: [polityUnit(), historyUnitTn(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'arith', name: 'Arithmetic', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'General Intelligence & Reasoning', units: [reasoningUnit()] },
      ] },
      { slug: 'pet-pmt', name: 'PET / PMT', subjects: [] },
    ],
  },

  // ═══ DEFENCE & POLICE ═══
  {
    slug: 'nda', name: 'National Defence Academy & Naval Academy Examination', shortName: 'NDA & NA',
    authority: 'Union Public Service Commission', category: 'defence-police', featured: true,
    description: 'Entry to the National Defence Academy (Army/Navy/Air Force wings) and Naval Academy via UPSC written examination and SSB interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Written pattern mapped with Maths and GAT subjects; topic notes/questions available for shared GAT and Maths areas.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      {
        slug: 'written', name: 'Written Examination',
        paperNote: 'Mathematics: 120 questions, 300 marks, 2.5 hours. GAT: 150 questions, 600 marks, 2.5 hours (English 50 Q + General Knowledge 100 Q). Negative marking 1/3rd of marks assigned.',
        pattern: {
          durationMin: 150, totalQuestions: 270, totalMarks: 900, negativeMark: 0,
          sections: [
            { name: 'Mathematics', questions: 120, marks: 300, durationMin: 150 },
            { name: 'General Ability Test', questions: 150, marks: 600, durationMin: 150 },
          ],
        },
        subjects: [
          { slug: 'maths', name: 'Mathematics', icon: 'Calculator', units: [arithmeticUnit(), { slug: 'algebra', name: 'Algebra & Quadratics', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] }] },
          { slug: 'gat', name: 'General Ability Test', icon: 'Globe', units: [
            { slug: 'english-gat', name: 'English (Part A)', topics: englishUnit().topics },
            { slug: 'gk-gat', name: 'General Knowledge (Part B)', topics: [
              t('gat-physics', 'Physics', 'science-physics'), t('gat-chem', 'Chemistry', 'science-chemistry'),
              t('gat-bio', 'Biology', 'science-biology'), t('gat-history', 'History', 'history-modern'),
              t('gat-geo', 'Geography', 'geography-india'), t('gat-polity', 'Polity', 'polity-constitution'),
              t('gat-current', 'Current Events', 'current-affairs'),
            ] },
          ] },
        ],
      },
      { slug: 'ssb', name: 'SSB Interview', paperNote: 'Services Selection Board: 5-day testing (900 marks) plus medical examination.', subjects: [] },
    ],
  },
  {
    slug: 'cds', name: 'Combined Defence Services Examination (CDS)', shortName: 'CDS',
    authority: 'Union Public Service Commission', category: 'defence-police',
    description: 'Officer entry to IMA, INA, AFA and OTA via UPSC written examination and SSB interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Written pattern mapped; shares English, GK and Maths content.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      {
        slug: 'written', name: 'Written Examination',
        paperNote: 'English 120 Q (100 marks), General Knowledge 120 Q (100 marks), Elementary Mathematics 100 Q (100 marks, IMA/INA/AFA only). 2 hours per paper, negative marking 1/3rd.',
        pattern: {
          durationMin: 120, totalQuestions: 340, totalMarks: 300, negativeMark: 0.33,
          sections: [
            { name: 'English', questions: 120, marks: 100, durationMin: 120 },
            { name: 'General Knowledge', questions: 120, marks: 100, durationMin: 120 },
            { name: 'Elementary Mathematics', questions: 100, marks: 100, durationMin: 120 },
          ],
        },
        subjects: [
          { slug: 'english', name: 'English', icon: 'Languages', units: [englishUnit()] },
          { slug: 'gk', name: 'General Knowledge', icon: 'Globe', units: [
            { slug: 'gk-core', name: 'General Knowledge', topics: [
              t('gk-history', 'History', 'history-modern'), t('gk-geo', 'Geography', 'geography-india'),
              t('gk-polity', 'Polity', 'polity-constitution'), t('gk-physics', 'Physics', 'science-physics'),
              t('gk-bio', 'Biology', 'science-biology'), t('gk-current', 'Current Events', 'current-affairs'),
            ] },
          ] },
          { slug: 'maths', name: 'Elementary Mathematics', icon: 'Calculator', units: [arithmeticUnit(), { slug: 'algebra', name: 'Algebra & Quadratics', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] }] },
        ],
      },
      { slug: 'ssb', name: 'SSB Interview', subjects: [] },
    ],
  },
  {
    slug: 'afcat', name: 'Air Force Common Admission Test (AFCAT)', shortName: 'AFCAT',
    authority: 'Indian Air Force', category: 'defence-police',
    description: 'Officer entry into Flying and Ground Duty (Technical/Non-Technical) branches of the Indian Air Force.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'AFCAT paper structure recorded; EKT (technical) mapping pending.',
    sourceRefs: [{ label: 'AFCAT official portal', url: 'https://afcat.cdac.in' }],
    stages: [
      { slug: 'afcat-paper', name: 'AFCAT (Online)', paperNote: '100 questions, 300 marks, 2 hours: General Awareness, Verbal Ability, Numerical Ability, Reasoning & Military Aptitude. Negative marking 1/3rd.', subjects: [
        { slug: 'ga', name: 'General Awareness', units: [{ slug: 'ga-core', name: 'Awareness', topics: [t('ga-history', 'History', 'history-modern'), t('ga-polity', 'Polity', 'polity-constitution'), t('ga-geo', 'Geography', 'geography-india'), t('ga-current', 'Current Events', 'current-affairs')] }] },
        { slug: 'verbal', name: 'Verbal Ability in English', units: [englishUnit()] },
        { slug: 'numerical', name: 'Numerical Ability', units: [arithmeticUnit()] },
        { slug: 'reasoning', name: 'Reasoning & Military Aptitude', units: [reasoningUnit()] },
      ] },
      { slug: 'ekt', name: 'EKT (Technical branch) + AFSB', subjects: [] },
    ],
  },
  {
    slug: 'agniveer-army', name: 'Agniveer — Indian Army (Common Entrance Examination)', shortName: 'Agniveer Army',
    authority: 'Indian Army', category: 'defence-police',
    description: 'Agniveer recruitment for the Indian Army via online Common Entrance Examination (Phase 1), physical fitness/measurement tests (Phase 2) and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CEE structure recorded at high level; shares matriculation-level general content.',
    sourceRefs: [{ label: 'Join Indian Army', url: 'https://joinindianarmy.nic.in' }],
    stages: [
      { slug: 'cee', name: 'Phase 1 — CEE (Online)', paperNote: 'Objective test: General Knowledge, General Science, Maths and Logical Reasoning (50 questions, 100 marks, 60 minutes per latest pattern — verify notification).', subjects: [
        { slug: 'gk', name: 'General Knowledge & Science', units: [polityUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'math-reasoning', name: 'Maths & Logical Reasoning', units: [arithmeticUnit(), reasoningUnit()] },
      ] },
      { slug: 'physical', name: 'Phase 2 — PFMT & Phase 3 — Medical', subjects: [] },
    ],
  },
  {
    slug: 'agniveer-vayu', name: 'Agniveer Vayu — Indian Air Force', shortName: 'Agniveer Vayu',
    authority: 'Indian Air Force', category: 'defence-police',
    description: 'Agniveer Vayu intake via online test, Physical Fitness Test, adaptability tests and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Online test structure recorded; science-subject variants depend on stream.',
    sourceRefs: [{ label: 'Agniveer Vayu portal', url: 'https://agnipathvayu.cdac.in' }],
    stages: [
      { slug: 'online-test', name: 'Phase 1 — Online Test', paperNote: 'Science subjects: English, Maths, Physics (+ optional variant); Non-science: English, RAGA (Reasoning & General Awareness) — verify latest notification.', subjects: [
        { slug: 'english-maths-physics', name: 'Science Stream Core', units: [englishUnit(), arithmeticUnit(), scienceUnit()] },
        { slug: 'raga', name: 'Reasoning & General Awareness', units: [reasoningUnit(), currentEventsUnit()] },
      ] },
      { slug: 'pft', name: 'Phase 2/3 — PFT, Adaptability & Medical', subjects: [] },
    ],
  },
  {
    slug: 'agniveer-ssr', name: 'Agniveer SSR — Indian Navy', shortName: 'Agniveer SSR',
    authority: 'Indian Navy', category: 'defence-police',
    description: 'Agniveer Senior Secondary Recruit (SSR) intake via computer-based examination (INET-style), Physical Fitness Test and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT structure recorded; science-stream emphasis.',
    sourceRefs: [{ label: 'Indian Navy Agniveer portal', url: 'https://agniveernavy.cdac.in' }],
    stages: [
      { slug: 'cbt', name: 'Phase 1 — CBT', paperNote: '100 questions, 100 marks, 1 hour: English, Science, Maths and General Awareness. Negative marking 0.25.', subjects: [
        { slug: 'english', name: 'English', units: [englishUnit()] },
        { slug: 'science', name: 'Science', units: [scienceUnit()] },
        { slug: 'maths', name: 'Mathematics', units: [arithmeticUnit()] },
        { slug: 'ga', name: 'General Awareness', units: [currentEventsUnit(), polityUnit()] },
      ] },
      { slug: 'pft', name: 'Phase 2 — PFT & Medical', subjects: [] },
    ],
  },
  {
    slug: 'capf-ac', name: 'CAPF Assistant Commandant Examination', shortName: 'CAPF AC',
    authority: 'Union Public Service Commission', category: 'defence-police',
    description: 'Assistant Commandant recruitment for BSF, CRPF, CISF, ITBP and SSB via UPSC written examination, physical/medical tests and interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Paper 1 (GS/MCQ) mapped; Paper 2 (descriptive) shares essay/comprehension content.',
    sourceRefs: [{ label: 'UPSC official website', url: 'https://upsc.gov.in' }],
    stages: [
      {
        slug: 'paper-1', name: 'Paper 1 — General Ability & Intelligence',
        paperNote: '125 questions, 250 marks, 2 hours. Negative marking 1/3rd of marks assigned.',
        pattern: {
          durationMin: 120, totalQuestions: 125, totalMarks: 250, negativeMark: 0.66,
          sections: [{ name: 'General Ability & Intelligence', questions: 125, marks: 250 }],
        },
        subjects: [
          { slug: 'ga', name: 'General Mental Ability & GS', units: [polityUnit(), historyUnitTn(), geographyUnit(), economyUnit(), scienceUnit(), environmentUnit(), currentEventsUnit(), reasoningUnit()] },
        ],
      },
      { slug: 'paper-2', name: 'Paper 2 — Descriptive', paperNote: 'Essay, precis writing and comprehension (English/Hindi), 200 marks, 3 hours.', subjects: [
        { slug: 'descriptive', name: 'Essay & Comprehension', units: [{ slug: 'essay-core', name: 'Writing Skills', topics: [t('essay-writing', 'Essay & Precis Writing', 'english-comprehension')] }] },
      ] },
      { slug: 'pet-interview', name: 'PET / Medical & Interview', subjects: [] },
    ],
  },
  {
    slug: 'up-police-si', name: 'UP Police Sub-Inspector Recruitment', shortName: 'UP Police SI',
    authority: 'UP Police Recruitment & Promotion Board', category: 'defence-police', state: 'Uttar Pradesh',
    description: 'Sub-Inspector recruitment for Uttar Pradesh Police via online written examination, physical tests and document verification.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Written structure recorded at high level; shares general content.',
    sourceRefs: [{ label: 'UPPRPB official website', url: 'https://uppbpb.gov.in' }],
    stages: [
      { slug: 'written', name: 'Online Written Examination', paperNote: 'Hindi, Basic Law/Constitution, Numerical & Mental Ability, Mental Aptitude/Reasoning — 400 marks (4 papers of 100). Verify latest notification.', subjects: [
        { slug: 'law-constitution', name: 'Law & Constitution', units: [polityUnit()] },
        { slug: 'numerical-mental', name: 'Numerical & Mental Ability', units: [arithmeticUnit(), reasoningUnit()] },
        { slug: 'gk', name: 'General Knowledge & Current Affairs', units: [historyUnitTn(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'physical', name: 'PET / PST & DV', subjects: [] },
    ],
  },
  {
    slug: 'delhi-police-constable', name: 'Delhi Police Constable (Executive) Recruitment', shortName: 'Delhi Police Constable',
    authority: 'Staff Selection Commission', category: 'defence-police', state: 'Delhi',
    description: 'Constable (Executive) recruitment for Delhi Police conducted by SSC via CBT followed by PE&MT and medical examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'CBT structure recorded; shares SSC-style content.',
    sourceRefs: [{ label: 'SSC official website', url: 'https://ssc.gov.in' }],
    stages: [
      { slug: 'cbt', name: 'Computer Based Test', paperNote: '100 questions, 100 marks, 90 minutes: General Knowledge & Current Affairs 50, Reasoning 25, Numerical Ability 25. Negative marking 0.25.', subjects: [
        { slug: 'gk', name: 'General Knowledge & Current Affairs', units: [polityUnit(), historyUnitTn(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'reasoning', name: 'Reasoning', units: [reasoningUnit()] },
        { slug: 'numerical', name: 'Numerical Ability', units: [arithmeticUnit()] },
      ] },
      { slug: 'peemt', name: 'PE&MT & Medical', subjects: [] },
    ],
  },

  // ═══ ENGINEERING & MEDICAL ═══
  {
    slug: 'jee-main', name: 'JEE Main (B.E./B.Tech & B.Arch/B.Planning)', shortName: 'JEE Main',
    authority: 'National Testing Agency', category: 'engineering-medical', featured: true,
    description: 'National engineering entrance for NITs, IIITs and other centrally funded institutions; also the qualifier for JEE Advanced.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Paper 1 (Physics/Chemistry/Maths) mapped at unit level with notes and questions for foundational topics. Full chapter-level extraction pending.',
    sourceRefs: [{ label: 'NTA JEE Main', url: 'https://jeemain.nta.nic.in' }],
    stages: [
      {
        slug: 'paper-1', name: 'Paper 1 — B.E./B.Tech',
        paperNote: '75 questions, 300 marks, 3 hours (Physics/Chemistry/Maths). +4 correct, −1 incorrect (verify latest pattern for MCQ/numerical split).',
        pattern: {
          durationMin: 180, totalQuestions: 75, totalMarks: 300, negativeMark: 1,
          sections: [
            { name: 'Physics', questions: 25, marks: 100 },
            { name: 'Chemistry', questions: 25, marks: 100 },
            { name: 'Mathematics', questions: 25, marks: 100 },
          ],
        },
        subjects: [
          { slug: 'physics', name: 'Physics', icon: 'Atom', units: [
            { slug: 'mechanics', name: 'Mechanics', topics: [t('kinematics', 'Kinematics', 'neet-physics-kinematics'), t('units-dim', 'Units & Dimensions', 'physics-units-dimensions')] },
          ] },
          { slug: 'chemistry', name: 'Chemistry', icon: 'FlaskConical', units: [
            { slug: 'physical-chem', name: 'Physical Chemistry', topics: [t('mole-concept', 'Some Basic Concepts & Mole Concept', 'neet-chem-mole-concept')] },
          ] },
          { slug: 'maths', name: 'Mathematics', icon: 'Sigma', units: [
            { slug: 'algebra', name: 'Algebra', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] },
          ] },
        ],
      },
    ],
  },
  {
    slug: 'jee-advanced', name: 'JEE Advanced', shortName: 'JEE Advanced',
    authority: 'Indian Institute of Technology (rotating)', category: 'engineering-medical',
    description: 'Admission to IITs for top JEE Main qualifiers. Two compulsory papers with MCQ, numerical and matching-type questions.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Shares JEE Main subjects at advanced depth; chapter mapping pending.',
    sourceRefs: [{ label: 'JEE Advanced official', url: 'https://jeeadv.ac.in' }],
    stages: [
      { slug: 'paper-1-2', name: 'Paper 1 & Paper 2', paperNote: 'Two 3-hour papers covering Physics, Chemistry and Mathematics with varied question types. Both compulsory.', subjects: [
        { slug: 'physics', name: 'Physics', units: [{ slug: 'mechanics', name: 'Mechanics', topics: [t('kinematics', 'Kinematics', 'neet-physics-kinematics'), t('units-dim', 'Units & Dimensions', 'physics-units-dimensions')] }] },
        { slug: 'chemistry', name: 'Chemistry', units: [{ slug: 'physical-chem', name: 'Physical Chemistry', topics: [t('mole-concept', 'Mole Concept', 'neet-chem-mole-concept')] }] },
        { slug: 'maths', name: 'Mathematics', units: [{ slug: 'algebra', name: 'Algebra', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] }] },
      ] },
    ],
  },
  {
    slug: 'gate', name: 'Graduate Aptitude Test in Engineering (GATE)', shortName: 'GATE',
    authority: 'Indian Institute of Technology (rotating)', category: 'engineering-medical', featured: true,
    description: 'Postgraduate engineering admissions and PSU recruitment gateway. Single paper per chosen discipline (General Aptitude common).',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'General Aptitude mapped; discipline-specific papers are engineering-degree level and mapping is pending.',
    sourceRefs: [{ label: 'GATE official website', url: 'https://gate.iitk.ac.in' }],
    stages: [
      { slug: 'gate-paper', name: 'GATE Examination', paperNote: '100 marks, 3 hours: General Aptitude (15 marks) + Engineering Mathematics and discipline subjects (85 marks, varies by paper).', subjects: [
        { slug: 'general-aptitude', name: 'General Aptitude', icon: 'Brain', units: [
          { slug: 'ga-verbal', name: 'Verbal & Numerical Aptitude', topics: [t('ga-quant', 'Quantitative Aptitude', 'aptitude-percentages'), t('ga-reasoning', 'Reasoning', 'reasoning-series'), t('ga-english', 'Verbal Ability', 'english-vocabulary')] },
        ] },
      ] },
    ],
  },
  {
    slug: 'neet-ug', name: 'NEET Undergraduate (UG)', shortName: 'NEET UG',
    authority: 'National Testing Agency', category: 'engineering-medical', featured: true,
    description: 'Sole national entrance for MBBS, BDS, AYUSH and nursing admissions. Physics, Chemistry, Botany and Zoology from the NCERT syllabus.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Topic tree covers key foundational chapters with original notes and questions; full 97-chapter NCERT extraction in progress.',
    sourceRefs: [{ label: 'NTA NEET', url: 'https://neet.nta.nic.in' }],
    stages: [
      {
        slug: 'neet-paper', name: 'NEET UG Examination',
        paperNote: '180 questions, 720 marks, 180 minutes: Physics 45, Chemistry 45, Botany 45, Zoology 45. +4 correct, −1 incorrect (2025 pattern — no Section B).',
        pattern: {
          durationMin: 180, totalQuestions: 180, totalMarks: 720, negativeMark: 1,
          sections: [
            { name: 'Physics', questions: 45, marks: 180 },
            { name: 'Chemistry', questions: 45, marks: 180 },
            { name: 'Botany', questions: 45, marks: 180 },
            { name: 'Zoology', questions: 45, marks: 180 },
          ],
        },
        subjects: [
          { slug: 'physics', name: 'Physics', icon: 'Atom', units: [
            { slug: 'mechanics', name: 'Mechanics', topics: [t('kinematics', 'Motion in a Straight Line & Plane', 'neet-physics-kinematics'), t('units-dim', 'Units, Dimensions & Measurement', 'physics-units-dimensions')] },
          ] },
          { slug: 'chemistry', name: 'Chemistry', icon: 'FlaskConical', units: [
            { slug: 'physical-chem', name: 'Physical Chemistry', topics: [t('mole-concept', 'Some Basic Concepts of Chemistry & Mole Concept', 'neet-chem-mole-concept')] },
          ] },
          { slug: 'botany', name: 'Botany', icon: 'Leaf', units: [
            { slug: 'cell-plant', name: 'Cell Biology & Plant Physiology', topics: [t('cell-structure', 'Cell: The Unit of Life', 'neet-bio-cell'), t('photosynthesis', 'Photosynthesis in Higher Plants')] },
          ] },
          { slug: 'zoology', name: 'Zoology', icon: 'HeartPulse', units: [
            { slug: 'human-physiology', name: 'Human Physiology', topics: [t('breathing', 'Breathing & Exchange of Gases', 'neet-bio-human-physiology'), t('body-fluids', 'Body Fluids & Circulation')] },
          ] },
        ],
      },
    ],
  },
  {
    slug: 'neet-pg', name: 'NEET Postgraduate (PG)', shortName: 'NEET PG',
    authority: 'National Board of Examinations in Medical Sciences (NBEMS)', category: 'engineering-medical',
    description: 'National entrance for MD/MS/PG Diploma admissions for MBBS graduates. Computer-based test across pre-clinical, para-clinical and clinical subjects.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Examination structure recorded at high level; subject-wise question bank pending (requires postgraduate-level content).',
    sourceRefs: [{ label: 'NBEMS', url: 'https://natboard.edu.in' }],
    stages: [
      { slug: 'neet-pg-paper', name: 'NEET PG Examination', paperNote: 'Computer-based MCQ test across the MBBS curriculum; pattern has been revised by NBEMS in recent years — always verify the latest information bulletin.', subjects: [] },
    ],
  },
  {
    slug: 'inicet', name: 'INI CET (Institute of National Importance CET)', shortName: 'INI CET',
    authority: 'All India Institute of Medical Sciences (AIIMS), New Delhi', category: 'engineering-medical',
    description: 'Entrance for MD/MS/DM/MCh admissions at AIIMS, JIPMER, PGIMER and NIMHANS.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; subject-wise bank pending.',
    sourceRefs: [{ label: 'AIIMS Exams', url: 'https://www.aiimsexams.org' }],
    stages: [
      { slug: 'inicet-paper', name: 'INI CET Examination', paperNote: 'Computer-based MCQ test, 200 questions, 3 hours (verify latest bulletin).', subjects: [] },
    ],
  },
  {
    slug: 'bitsat', name: 'BITS Admission Test (BITSAT)', shortName: 'BITSAT',
    authority: 'Birla Institute of Technology and Science, Pilani', category: 'engineering-medical',
    description: 'Online entrance for admission to BITS Pilani, Goa and Hyderabad campuses.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares JEE-style PCM content.',
    sourceRefs: [{ label: 'BITS admission', url: 'https://www.bitsadmission.com' }],
    stages: [
      { slug: 'bitsat-paper', name: 'BITSAT Session', paperNote: '130 questions (Physics 30, Chemistry 30, Maths/Biology 40, English 10, Logical Reasoning 20), +3/−1, 3 hours.', subjects: [
        { slug: 'physics', name: 'Physics', units: [{ slug: 'mechanics', name: 'Mechanics', topics: [t('kinematics', 'Kinematics', 'neet-physics-kinematics')] }] },
        { slug: 'english-reasoning', name: 'English & Logical Reasoning', units: [englishUnit(), reasoningUnit()] },
        { slug: 'maths', name: 'Mathematics', units: [{ slug: 'algebra', name: 'Algebra', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] }] },
      ] },
    ],
  },
  {
    slug: 'ap-eapcet', name: 'AP EAPCET (Engineering, Agriculture & Pharmacy)', shortName: 'AP EAPCET',
    authority: 'Convenor, AP EAPCET on behalf of AP State Council of Higher Education', category: 'engineering-medical', state: 'Andhra Pradesh',
    description: 'Andhra Pradesh state entrance for engineering, agriculture and pharmacy admissions.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares PCM/PCB intermediate-level content.',
    sourceRefs: [{ label: 'AP EAPCET official', url: 'https://cets.apsche.ap.gov.in' }],
    stages: [
      { slug: 'eapcet-paper', name: 'EAPCET Examination', paperNote: '160 questions (Maths 80, Physics 40, Chemistry 40 for engineering stream), no negative marking.', subjects: [
        { slug: 'maths', name: 'Mathematics', units: [{ slug: 'algebra', name: 'Algebra', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] }] },
        { slug: 'physics', name: 'Physics', units: [{ slug: 'mechanics', name: 'Mechanics', topics: [t('kinematics', 'Kinematics', 'neet-physics-kinematics')] }] },
        { slug: 'chemistry', name: 'Chemistry', units: [{ slug: 'physical-chem', name: 'Physical Chemistry', topics: [t('mole-concept', 'Mole Concept', 'neet-chem-mole-concept')] }] },
      ] },
    ],
  },

  // ═══ UNIVERSITY & PROFESSIONAL ═══
  {
    slug: 'cuet-ug', name: 'CUET Undergraduate (UG)', shortName: 'CUET UG',
    authority: 'National Testing Agency', category: 'university-professional', featured: true,
    description: 'Common University Entrance Test (CBT) for undergraduate admissions to central, state and participating universities. Candidates choose up to five test papers from 13 languages, 23 domain subjects and the General Aptitude Test. Each paper: 50 MCQs (all compulsory) in 60 minutes — +5 per correct answer, −1 per incorrect answer (CUET UG 2026 information bulletin).',
    syllabusStatus: 'VERIFIED',
    contentNote: 'Full official syllabus mapped for all 37 subjects (13 languages, 23 domain subjects, General Aptitude Test) directly from the NTA CUET (UG) 2026 bulletin and the official subject-wise syllabus PDFs. Original notes and practice questions currently cover the General Aptitude Test, English language skills and selected flagship domain topics — the remaining domain topics show their official units honestly marked “material in progress”.',
    sourceRefs: [
      { label: 'NTA CUET portal', url: 'https://cuet.nta.nic.in' },
      { label: 'CUET (UG) 2026 information bulletin (PDF)', url: 'https://cdnbbsr.s3waas.gov.in/s3d1a21da7bca4abff8b0b61b87597de73/uploads/2026/01/202601031633478370.pdf' },
      { label: 'Subject-wise syllabus PDFs (official)', url: 'https://cuet.nta.nic.in/cuetug-2026-syllabus/' },
    ],
    stages: [
      {
        slug: 'cuet-ug-paper', name: 'CUET UG Examination',
        paperNote: 'Choose up to 5 test papers from 13 languages, 23 domain subjects and the General Aptitude Test. Every paper: 50 MCQs, all compulsory, 60 minutes, CBT. Marking: +5 correct, −1 incorrect. Domain-subject syllabus follows the Class-12 NCERT; the pattern above describes one test paper.',
        pattern: {
          durationMin: 60, totalQuestions: 50, totalMarks: 250, negativeMark: 1, marksPerQuestion: 5,
          sections: [{ name: 'Each test paper (any of the 37 subjects)', questions: 50, marks: 250, durationMin: 60 }],
        },
        subjects: [
          // ── Section III — General Aptitude Test (code 501) ──
          { slug: 'general-test', name: 'General Aptitude Test (GAT)', icon: 'Brain', description: 'Official outline (2026 syllabus PDF): General Knowledge, Current Affairs, General Mental Ability, Numerical Ability, Quantitative Reasoning (arithmetic, algebra, geometry, mensuration, statistics), Logical & Analytical Reasoning, General Science and Environmental Literacy.', units: [
            { slug: 'gt-quant-reasoning', name: 'Numerical Ability & Quantitative Reasoning', description: 'Arithmetic, algebra and quantitative application — Class-12 level simple application of basic mathematical concepts.', topics: [
              t('gt-percentages', 'Percentages', 'aptitude-percentages'),
              t('gt-ratio', 'Ratio & Proportion', 'aptitude-ratio'),
              t('gt-average', 'Averages', 'aptitude-average'),
              t('gt-profit-loss', 'Profit, Loss & Discount', 'aptitude-profit-loss'),
              t('gt-si-ci', 'Simple & Compound Interest', 'aptitude-si-ci'),
              t('gt-time-work', 'Time & Work', 'aptitude-time-work'),
              t('gt-time-speed-distance', 'Time, Speed & Distance', 'aptitude-time-speed-distance'),
              t('gt-number-system', 'Number System & Simplification', 'aptitude-number-system'),
              t('gt-data-interpretation', 'Data Interpretation & Statistics Basics', 'aptitude-data-interpretation'),
              t('gt-series', 'Number & Letter Series', 'reasoning-series'),
              t('gt-geometry-mensuration', 'Geometry, Mensuration & Trigonometry Basics'),
            ] },
            { slug: 'gt-mental-ability', name: 'General Mental Ability, Logical & Analytical Reasoning', description: 'Verbal and non-verbal reasoning: deduction, arrangements, coding and relationships.', topics: [
              t('gt-syllogism', 'Syllogisms & Logical Deduction', 'reasoning-syllogism'),
              t('gt-puzzles', 'Seating Arrangements & Puzzles', 'reasoning-puzzles'),
              t('gt-blood-relations', 'Blood Relations & Family Trees', 'reasoning-blood-relations'),
              t('gt-directions', 'Direction Sense', 'reasoning-directions'),
              t('gt-coding-decoding', 'Coding–Decoding & Analogy', 'reasoning-coding'),
            ] },
            { slug: 'gt-gk', name: 'General Knowledge, Current Affairs & Science', description: 'Static GK, current events, and general science with environmental literacy (per the official GAT syllabus).', topics: [
              t('gt-polity', 'Polity & Governance', 'polity-constitution'),
              t('gt-history', 'History & Culture', 'history-modern'),
              t('gt-current', 'Current Affairs', 'current-affairs'),
              t('gt-science-env', 'General Science & Environmental Literacy', 'cuet-gat-science-env'),
            ] },
          ] },
          // ── Languages (Section IA — codes 101–113) ──
          { slug: 'language', name: 'Languages (13 offered)', icon: 'Languages', description: 'Assamese, Bengali, English, Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu, Urdu (codes 101–113). Official outline for every language test: reading comprehension based on factual, narrative and literary passages, literary aptitude and vocabulary. Notes below use English (101) as the model; the per-language official syllabus PDFs are linked under Study Material.', units: [
            { slug: 'lang-core', name: 'Reading Comprehension & Verbal Ability', description: 'The official language-test outline (English 101 shown): RC (factual, narrative, literary — passages up to 300 words) and verbal ability (rearranging parts, match the following, choosing the correct word, synonyms & antonyms).', topics: [
              t('comprehension', 'Reading Comprehension: Factual, Narrative & Literary Passages', 'english-comprehension'),
              t('lang-verbal-ability', 'Verbal Ability: Rearranging Parts, Match the Following, Correct Word', 'cuet-lang-verbal-ability'),
              t('lang-literary-aptitude', 'Literary Aptitude', 'cuet-lang-literary-aptitude'),
              t('vocabulary', 'Vocabulary: Synonyms, Antonyms & Word Choice', 'english-vocabulary'),
              t('grammar', 'Grammar & Sentence Correctness (support skill)', 'english-grammar'),
              t('error-spotting', 'Sentence Correction & Error Spotting (support skill)', 'english-error-spotting'),
            ] },
          ] },
          ...CUET_DOMAIN_SUBJECTS,
        ] },
      ],
  },
  {
    slug: 'cuet-pg', name: 'CUET Postgraduate (PG)', shortName: 'CUET PG',
    authority: 'National Testing Agency', category: 'university-professional',
    description: 'Common University Entrance Test for postgraduate admissions to participating universities.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; subject papers are degree-level and mapping pending.',
    sourceRefs: [{ label: 'NTA CUET PG', url: 'https://cuetpg.nta.nic.in' }],
    stages: [
      { slug: 'cuet-pg-paper', name: 'CUET PG Examination', paperNote: '75 questions, 300 marks, 90 minutes (+4/−1) per subject paper.', subjects: [] },
    ],
  },
  {
    slug: 'clat', name: 'Common Law Admission Test (CLAT)', shortName: 'CLAT',
    authority: 'Consortium of National Law Universities', category: 'university-professional', featured: true,
    description: 'National entrance for UG (5-year integrated) and PG law programmes at the National Law Universities.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'UG paper sections mapped: English, Current Affairs including GK, Legal Reasoning, Logical Reasoning and Quantitative Techniques.',
    sourceRefs: [{ label: 'Consortium of NLUs', url: 'https://consortiumofnlus.ac.in' }],
    stages: [
      {
        slug: 'clat-ug', name: 'CLAT UG Examination',
        paperNote: '120 questions, 120 marks, 2 hours; comprehension-based sections: English 22–26, Current Affairs incl. GK 28–32, Legal Reasoning 28–32, Logical Reasoning 22–26, Quantitative Techniques 10–14. Negative marking 0.25.',
        pattern: {
          durationMin: 120, totalQuestions: 120, totalMarks: 120, negativeMark: 0.25,
          sections: [
            { name: 'English Language', questions: 24, marks: 24 },
            { name: 'Current Affairs incl. GK', questions: 30, marks: 30 },
            { name: 'Legal Reasoning', questions: 30, marks: 30 },
            { name: 'Logical Reasoning', questions: 24, marks: 24 },
            { name: 'Quantitative Techniques', questions: 12, marks: 12 },
          ],
        },
        subjects: [
          { slug: 'english', name: 'English Language', icon: 'Languages', units: [englishUnit()] },
          { slug: 'current-gk', name: 'Current Affairs incl. GK', icon: 'Globe', units: [currentEventsUnit(), polityUnit()] },
          { slug: 'legal-reasoning', name: 'Legal Reasoning', icon: 'Scale', units: [
            { slug: 'legal-core', name: 'Legal Principles & Reasoning', topics: [t('legal-constitution', 'Constitution & Legal Principles', 'polity-constitution')] },
          ] },
          { slug: 'logical-reasoning', name: 'Logical Reasoning', icon: 'Brain', units: [reasoningUnit()] },
          { slug: 'quant-techniques', name: 'Quantitative Techniques', icon: 'Calculator', units: [
            { slug: 'qt-core', name: 'Quantitative Techniques', topics: [t('qt-percentages', 'Percentages', 'aptitude-percentages'), t('qt-ratio', 'Ratio & Proportion', 'aptitude-ratio'), t('qt-average', 'Averages', 'aptitude-average'), t('qt-di', 'Data Interpretation', 'aptitude-data-interpretation')] },
          ] },
        ],
      },
    ],
  },
  {
    slug: 'ailet', name: 'All India Law Entrance Test (AILET)', shortName: 'AILET',
    authority: 'National Law University, Delhi', category: 'university-professional',
    description: 'Entrance examination for BA LL.B. (Hons.), LL.M. and Ph.D. programmes at NLU Delhi.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'UG structure recorded; shares CLAT-style content.',
    sourceRefs: [{ label: 'NLU Delhi AILET', url: 'https://nationallawuniversitydelhi.in' }],
    stages: [
      { slug: 'ailet-ug', name: 'AILET UG Examination', paperNote: '150 questions, 150 marks, 90 minutes: English 50, Current Affairs & GK 30, Logical Reasoning 70 (as per recent pattern — verify latest). Negative marking 0.25.', subjects: [
        { slug: 'english', name: 'English', units: [englishUnit()] },
        { slug: 'gk', name: 'Current Affairs & GK', units: [currentEventsUnit()] },
        { slug: 'logical', name: 'Logical Reasoning', units: [reasoningUnit()] },
      ] },
    ],
  },
  {
    slug: 'cat', name: 'Common Admission Test (CAT)', shortName: 'CAT',
    authority: 'Indian Institutes of Management (rotating)', category: 'university-professional', featured: true,
    description: 'Entrance for MBA/PGP programmes at the IIMs and other top B-schools. Three timed sections: VARC, DILR and QA.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Section structure mapped; question-level content shares aptitude/English/DI topics.',
    sourceRefs: [{ label: 'IIM CAT', url: 'https://iimcat.ac.in' }],
    stages: [
      {
        slug: 'cat-paper', name: 'CAT Examination',
        paperNote: '120 minutes total with three sections of 40 minutes each: VARC, DILR and QA (question counts vary by year). TITA questions have no negative marking.',
        pattern: {
          durationMin: 120, totalQuestions: 66, totalMarks: 198, negativeMark: 1,
          sections: [
            { name: 'Verbal Ability & Reading Comprehension', questions: 24, marks: 72, durationMin: 40 },
            { name: 'Data Interpretation & Logical Reasoning', questions: 20, marks: 60, durationMin: 40 },
            { name: 'Quantitative Ability', questions: 22, marks: 66, durationMin: 40 },
          ],
        },
        subjects: [
          { slug: 'varc', name: 'Verbal Ability & Reading Comprehension', icon: 'Languages', units: [englishUnit()] },
          { slug: 'dilr', name: 'Data Interpretation & Logical Reasoning', icon: 'Brain', units: [
            { slug: 'dilr-core', name: 'DI & LR Sets', topics: [t('di', 'Data Interpretation', 'aptitude-data-interpretation'), t('puzzles', 'Puzzles & Arrangements', 'reasoning-puzzles'), t('series', 'Series', 'reasoning-series')] },
          ] },
          { slug: 'qa', name: 'Quantitative Ability', icon: 'Calculator', units: [arithmeticUnit(), { slug: 'algebra', name: 'Algebra', topics: [t('quadratic', 'Quadratic Equations', 'math-quadratic')] }] },
        ],
      },
    ],
  },
  {
    slug: 'nift-entrance', name: 'NIFT Entrance Examination', shortName: 'NIFT',
    authority: 'National Institute of Fashion Technology', category: 'university-professional',
    description: 'Entrance for NIFT design programmes: CAT (Creative Ability), GAT (General Ability) and Situation Test.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; GAT shares aptitude/English content.',
    sourceRefs: [{ label: 'NIFT admissions', url: 'https://www.nift.ac.in' }],
    stages: [
      { slug: 'cat-gat', name: 'CAT & GAT (Written)', paperNote: 'CAT tests creative ability; GAT covers Quantitative Ability, Communication Ability, English Comprehension, Analytical Ability and General Knowledge.', subjects: [
        { slug: 'gat', name: 'GAT Sections', units: [arithmeticUnit(), englishUnit(), reasoningUnit()] },
      ] },
      { slug: 'situation-test', name: 'Situation Test / Studio Test', subjects: [] },
    ],
  },
  {
    slug: 'nid-dat', name: 'NID Design Aptitude Test (DAT)', shortName: 'NID DAT',
    authority: 'National Institute of Design', category: 'university-professional',
    description: 'Entrance for B.Des and M.Des programmes at NID campuses via DAT Prelims and DAT Mains (studio test/interview).',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; DAT shares general aptitude content.',
    sourceRefs: [{ label: 'NID admissions', url: 'https://admissions.nid.edu' }],
    stages: [
      { slug: 'dat-prelims', name: 'DAT Prelims', paperNote: 'Design aptitude: sketching, visual reasoning, general awareness and design thinking.', subjects: [
        { slug: 'apt', name: 'General Aptitude', units: [reasoningUnit(), englishUnit()] },
      ] },
      { slug: 'dat-mains', name: 'DAT Mains (Studio Test)', subjects: [] },
    ],
  },
  {
    slug: 'uceed', name: 'UCEED (Undergraduate Common Entrance Examination for Design)', shortName: 'UCEED',
    authority: 'IIT Bombay', category: 'university-professional',
    description: 'Entrance for B.Des admissions at IIT Bombay, Delhi, Guwahati, Hyderabad and Roorkee plus IIITDM Jabalpur.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares reasoning/visual content.',
    sourceRefs: [{ label: 'UCEED official', url: 'https://www.uceed.iitb.ac.in' }],
    stages: [
      { slug: 'uceed-paper', name: 'UCEED Examination', paperNote: 'Part A (2 hours, computer-based: NAT, MSQ, MCQ on visualisation, observation, reasoning) + Part B (1 hour, drawing).', subjects: [
        { slug: 'part-a', name: 'Part A Sections', units: [reasoningUnit()] },
      ] },
    ],
  },
  {
    slug: 'cmat', name: 'Common Management Admission Test (CMAT)', shortName: 'CMAT',
    authority: 'National Testing Agency', category: 'university-professional',
    description: 'National-level entrance for management programmes accepted by AICTE-affiliated institutions.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares aptitude content.',
    sourceRefs: [{ label: 'NTA CMAT', url: 'https://cmat.nta.nic.in' }],
    stages: [
      { slug: 'cmat-paper', name: 'CMAT Examination', paperNote: '100 questions, 400 marks, 3 hours: Quantitative Techniques & DI, Logical Reasoning, Language Comprehension, General Awareness, Innovation & Entrepreneurship (20 Q each). Negative marking 1.', subjects: [
        { slug: 'quant-di', name: 'Quantitative Techniques & DI', units: [arithmeticUnit()] },
        { slug: 'lr', name: 'Logical Reasoning', units: [reasoningUnit()] },
        { slug: 'lang', name: 'Language Comprehension', units: [englishUnit()] },
        { slug: 'ga', name: 'General Awareness', units: [currentEventsUnit(), polityUnit()] },
      ] },
    ],
  },

  // ═══ TEACHING & RESEARCH ═══
  {
    slug: 'ctet', name: 'Central Teacher Eligibility Test (CTET)', shortName: 'CTET',
    authority: 'Central Board of Secondary Education', category: 'teaching-research', featured: true,
    description: 'National teacher eligibility test: Paper I (Classes I–V) and Paper II (Classes VI–VIII). Qualifying certificate valid for a lifetime.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Both papers structurally mapped with CDP, languages, maths and EVS/social-studies subjects.',
    sourceRefs: [{ label: 'CTET official website', url: 'https://ctet.nic.in' }],
    stages: [
      {
        slug: 'paper-1', name: 'Paper I (Classes I–V)',
        paperNote: '150 questions, 150 marks, 2.5 hours: CDP 30, Language I 30, Language II 30, Mathematics 30, EVS 30. No negative marking.',
        pattern: {
          durationMin: 150, totalQuestions: 150, totalMarks: 150, negativeMark: 0,
          sections: [
            { name: 'Child Development & Pedagogy', questions: 30, marks: 30 },
            { name: 'Language I', questions: 30, marks: 30 },
            { name: 'Language II', questions: 30, marks: 30 },
            { name: 'Mathematics', questions: 30, marks: 30 },
            { name: 'Environmental Studies', questions: 30, marks: 30 },
          ],
        },
        subjects: [
          { slug: 'cdp', name: 'Child Development & Pedagogy', icon: 'Users', units: [{ slug: 'cdp-core', name: 'Core Concepts', topics: [t('cdp-development', 'Child Development & Learning'), t('cdp-pedagogy', 'Pedagogy of Teaching')] }] },
          { slug: 'lang1', name: 'Language I (English)', icon: 'Languages', units: [englishUnit()] },
          { slug: 'math', name: 'Mathematics', icon: 'Calculator', units: [{ slug: 'math-primary', name: 'Primary Mathematics', topics: arithmeticUnit().topics.slice(0, 5) }] },
          { slug: 'evs', name: 'Environmental Studies', icon: 'Leaf', units: [{ slug: 'evs-core', name: 'EVS Concepts', topics: [t('evs-environment', 'Environment & Ecology', 'environment')] }] },
        ],
      },
      {
        slug: 'paper-2', name: 'Paper II (Classes VI–VIII)',
        paperNote: '150 questions, 150 marks, 2.5 hours: CDP 30, Language I 30, Language II 30, then Mathematics & Science (60) OR Social Studies (60). No negative marking.',
        pattern: {
          durationMin: 150, totalQuestions: 150, totalMarks: 150, negativeMark: 0,
          sections: [
            { name: 'Child Development & Pedagogy', questions: 30, marks: 30 },
            { name: 'Language I', questions: 30, marks: 30 },
            { name: 'Language II', questions: 30, marks: 30 },
            { name: 'Maths & Science / Social Studies', questions: 60, marks: 60 },
          ],
        },
        subjects: [
          { slug: 'cdp-2', name: 'Child Development & Pedagogy', icon: 'Users', units: [{ slug: 'cdp-core-2', name: 'Core Concepts', topics: [t('cdp-development-2', 'Child Development & Learning')] }] },
          { slug: 'lang1-2', name: 'Language I (English)', icon: 'Languages', units: [englishUnit()] },
          { slug: 'math-science', name: 'Mathematics & Science', icon: 'Calculator', units: [arithmeticUnit(), scienceUnit()] },
        ],
      },
    ],
  },
  {
    slug: 'ugc-net', name: 'UGC National Eligibility Test (NET) — JRF & Assistant Professor', shortName: 'UGC NET',
    authority: 'National Testing Agency on behalf of UGC', category: 'teaching-research',
    description: 'Eligibility for Junior Research Fellowship and Assistant Professor positions. Paper 1 (general) + Paper 2 (chosen subject).',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Paper 1 mapped (teaching/reasoning/DI/ICT); subject papers are postgraduate-level and mapping pending.',
    sourceRefs: [{ label: 'NTA UGC NET', url: 'https://ugcnet.nta.nic.in' }],
    stages: [
      {
        slug: 'paper-1', name: 'Paper 1 (General)',
        paperNote: '50 questions, 100 marks, 1 hour: Teaching Aptitude, Research Aptitude, Comprehension, Communication, Maths Reasoning, DI, ICT, People & Environment, Higher Education. No negative marking.',
        pattern: {
          durationMin: 60, totalQuestions: 50, totalMarks: 100, negativeMark: 0,
          sections: [{ name: 'General Paper 1', questions: 50, marks: 100 }],
        },
        subjects: [
          { slug: 'paper1-core', name: 'Paper 1 Units', icon: 'BookOpen', units: [
            { slug: 'reasoning-di', name: 'Maths Reasoning & DI', topics: [t('di', 'Data Interpretation', 'aptitude-data-interpretation'), t('series', 'Series & Reasoning', 'reasoning-series'), t('percentages', 'Percentages', 'aptitude-percentages'), t('average', 'Averages', 'aptitude-average')] },
            { slug: 'ict-env', name: 'ICT, People & Environment', topics: [t('ict', 'ICT & Computer Basics', 'computer-basics'), t('people-env', 'People, Development & Environment', 'environment')] },
            { slug: 'english-comp', name: 'Comprehension & Communication', topics: englishUnit().topics },
          ] },
        ],
      },
      { slug: 'paper-2', name: 'Paper 2 (Subject)', paperNote: '100 questions, 200 marks on the chosen postgraduate subject. Subject mapping pending.', subjects: [] },
    ],
  },
  {
    slug: 'csir-ugc-net', name: 'CSIR UGC NET (Joint CSIR-UGC Test for JRF)', shortName: 'CSIR NET',
    authority: 'National Testing Agency on behalf of CSIR', category: 'teaching-research',
    description: 'JRF/lectureship eligibility in science streams: Life Sciences, Physical Sciences, Chemical Sciences, Mathematical Sciences and Earth Sciences.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Part A (general aptitude) shares core content; subject parts are postgraduate-level and pending.',
    sourceRefs: [{ label: 'CSIR HRDG', url: 'https://csirhrdg.res.in' }],
    stages: [
      { slug: 'part-a', name: 'Part A — General Aptitude', paperNote: '20 questions (attempt 15), 30 marks: numerical ability, reasoning, data interpretation and graph analysis. Negative marking 0.5.', subjects: [
        { slug: 'aptitude', name: 'General Aptitude', units: [arithmeticUnit(), reasoningUnit()] },
      ] },
      { slug: 'subject-parts', name: 'Part B & C (Subject)', paperNote: 'Subject-specific MCQs at postgraduate level. Mapping pending.', subjects: [] },
    ],
  },
  {
    slug: 'kvs-recruitment', name: 'Kendriya Vidyalaya Sangathan (KVS) Teaching Recruitment', shortName: 'KVS Recruitment',
    authority: 'Kendriya Vidyalaya Sangathan', category: 'teaching-research',
    description: 'PRT, TGT, PGT and other posts in Kendriya Vidyalayas via written examination and professional competency test/interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares CTET-style CDP and subject content.',
    sourceRefs: [{ label: 'KVS official website', url: 'https://kvsangathan.nic.in' }],
    stages: [
      { slug: 'written', name: 'Written Examination', paperNote: 'Part I: Proficiency in Languages; Part II: General Awareness, Reasoning, Computer Literacy; Part III: Perspectives on Education & Leadership; Part IV: Subject-specific.', subjects: [
        { slug: 'part-1-2', name: 'Languages & General', units: [englishUnit(), reasoningUnit(), computerUnit()] },
        { slug: 'cdp-part', name: 'Perspectives on Education & Leadership', units: [{ slug: 'cdp-core', name: 'CDP Concepts', topics: [t('cdp-development', 'Child Development & Learning')] }] },
      ] },
    ],
  },
  {
    slug: 'nvs-recruitment', name: 'Navodaya Vidyalaya Samiti (NVS) Recruitment', shortName: 'NVS Recruitment',
    authority: 'Navodaya Vidyalaya Samiti', category: 'teaching-research',
    description: 'Teaching and non-teaching recruitment for Jawahar Navodaya Vidyalayas via computer-based examination.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares teaching-recruitment core content.',
    sourceRefs: [{ label: 'NVS official website', url: 'https://navodaya.gov.in' }],
    stages: [
      { slug: 'written', name: 'Computer Based Examination', paperNote: 'Sections vary by post: reasoning, general awareness, subject knowledge, teaching aptitude.', subjects: [
        { slug: 'general', name: 'General Sections', units: [reasoningUnit(), englishUnit(), currentEventsUnit()] },
      ] },
    ],
  },
  {
    slug: 'tn-trb', name: 'Tamil Nadu TRB Recruitment (PG Assistant / Lecturer)', shortName: 'TN TRB',
    authority: 'Teachers Recruitment Board, Tamil Nadu', category: 'teaching-research', state: 'Tamil Nadu',
    description: 'TRB Tamil Nadu recruitment of PG Assistants, Assistant Professors and other teaching posts via written examination and certificate verification.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; subject papers are degree-level and mapping pending.',
    sourceRefs: [{ label: 'TRB Tamil Nadu', url: 'https://trb.tn.gov.in' }],
    stages: [
      { slug: 'written', name: 'Written Examination', paperNote: 'Main subject paper plus Education Methodology unit (pattern varies by recruitment).', subjects: [] },
    ],
  },

  // ═══ OTHER STATES ═══
  {
    slug: 'uppsc-pcs', name: 'UPPSC Combined State / Upper Subordinate Services (PCS)', shortName: 'UPPSC PCS',
    authority: 'Uttar Pradesh Public Service Commission', category: 'other-states', state: 'Uttar Pradesh',
    description: 'Uttar Pradesh state civil services via Prelims (GS Paper 1 + CSAT), Mains and Interview.',
    syllabusStatus: 'PARTIAL',
    contentNote: 'Prelims structure mirrors UPSC CSE Prelims with UP-specific GK units; shares core content and tests.',
    sourceRefs: [{ label: 'UPPSC official website', url: 'https://uppsc.up.nic.in' }],
    stages: [
      {
        slug: 'prelims-gs1', name: 'Prelims — GS Paper 1',
        paperNote: '120 questions, 200 marks, 2 hours. Negative marking 1/3rd of marks assigned per wrong answer.',
        pattern: {
          durationMin: 120, totalQuestions: 120, totalMarks: 200, negativeMark: 0.66,
          sections: [{ name: 'General Studies Paper I', questions: 120, marks: 200 }],
        },
        subjects: [
          { slug: 'gs1', name: 'General Studies', icon: 'BookOpen', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), environmentUnit(), currentEventsUnit()] },
        ],
      },
      { slug: 'prelims-csat', name: 'Prelims — CSAT Paper 2', paperNote: 'Qualifying paper: comprehension, reasoning and numeracy.', subjects: [
        { slug: 'csat', name: 'CSAT', units: [reasoningUnit(), arithmeticUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'bpsc-cce', name: 'BPSC Combined Competitive Examination', shortName: 'BPSC CCE',
    authority: 'Bihar Public Service Commission', category: 'other-states', state: 'Bihar',
    description: 'Bihar state civil services via Prelims (GS), Mains (General Studies papers + Essay + Optional) and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'BPSC official website', url: 'https://bpsc.bihar.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims (GS)', paperNote: '150 questions, 150 marks, 2 hours, objective. No negative marking.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'mppsc-sse', name: 'MPPSC State Service Examination', shortName: 'MPPSC SSE',
    authority: 'Madhya Pradesh Public Service Commission', category: 'other-states', state: 'Madhya Pradesh',
    description: 'Madhya Pradesh state services via Prelims (2 papers), Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'MPPSC official website', url: 'https://mppsc.mp.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims (GS Paper 1 & 2)', paperNote: 'Paper 1: GS 100 Q/200 marks/2 hrs; Paper 2: CSAT 80 Q/200 marks/2 hrs.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'csat', name: 'CSAT', units: [reasoningUnit(), arithmeticUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'rpsc-ras', name: 'RPSC Rajasthan State & Subordinate Services (RAS/RTS)', shortName: 'RPSC RAS',
    authority: 'Rajasthan Public Service Commission', category: 'other-states', state: 'Rajasthan',
    description: 'Rajasthan administrative services via Prelims (GS + GK of Rajasthan), Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'RPSC official website', url: 'https://rpsc.rajasthan.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Single paper: 150 questions, 200 marks, 3 hours (GS including Rajasthan-specific GK). Negative marking 1/3rd.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'wbpsc-wbcs', name: 'West Bengal Civil Service (Executive) etc. Examination', shortName: 'WBCS',
    authority: 'West Bengal Public Service Commission', category: 'other-states', state: 'West Bengal',
    description: 'West Bengal civil services via Prelims, Mains and Personality Test.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'WBPSC official website', url: 'https://pbsc.wb.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: '200 questions, 200 marks, 2.5 hours: English, GK, Current Affairs, Arithmetic & Reasoning.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'apt', name: 'Arithmetic & Reasoning', units: [arithmeticUnit(), reasoningUnit()] },
        { slug: 'english', name: 'English Composition', units: [englishUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Personality Test', subjects: [] },
    ],
  },
  {
    slug: 'kpsc-kas', name: 'KPSC Karnataka Administrative Services (KAS) — Group A & B', shortName: 'KPSC KAS',
    authority: 'Karnataka Public Service Commission', category: 'other-states', state: 'Karnataka',
    description: 'Karnataka state civil services (Gazetted Probers Examination) via Prelims, Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'KPSC official website', url: 'https://kpsc.kar.nic.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Paper 1: GS 100 Q/200 marks; Paper 2: GS (CSAT-style) 100 Q/200 marks.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'kerala-psc-degree', name: 'Kerala PSC Degree Level Examinations', shortName: 'Kerala PSC Degree Level',
    authority: 'Kerala Public Service Commission', category: 'other-states', state: 'Kerala',
    description: 'Kerala PSC degree-level recruitment examinations (University Assistant, degree-level posts etc.) via OMR/CBT.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Common test structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'Kerala PSC official website', url: 'https://www.keralapsc.gov.in' }],
    stages: [
      { slug: 'degree-exam', name: 'Degree Level Examination', paperNote: '100 questions, 100 marks, 75–90 minutes: General Knowledge, English, Maths/Mental Ability, Current Affairs, Regional GK (Kerala).', subjects: [
        { slug: 'gs', name: 'General Knowledge', units: [historyUnitTn(), polityUnit(), geographyUnit(), scienceUnit(), currentEventsUnit()] },
        { slug: 'apt', name: 'Maths & Mental Ability', units: [arithmeticUnit(), reasoningUnit()] },
        { slug: 'english', name: 'English', units: [englishUnit()] },
      ] },
    ],
  },
  {
    slug: 'mpsc-rajyaseva', name: 'MPSC State Services Examination (Rajyaseva)', shortName: 'MPSC Rajyaseva',
    authority: 'Maharashtra Public Service Commission', category: 'other-states', state: 'Maharashtra',
    description: 'Maharashtra state services via Prelims, Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'MPSC official website', url: 'https://mpsc.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Paper 1: State Services GS 100 Q/200 marks; Paper 2: CSAT 80 Q/200 marks.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'gpsc-class-1-2', name: 'GPSC Class 1 & 2 Civil Services Examination', shortName: 'GPSC Class 1-2',
    authority: 'Gujarat Public Service Commission', category: 'other-states', state: 'Gujarat',
    description: 'Gujarat administrative services via Prelims, Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'GPSC official website', url: 'https://gpsc.gujarat.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Two objective papers: GS Paper 1 (History, Culture, Geography) and Paper 2 (Polity, Economy, Science, Current Affairs).', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'hpsc-hcs', name: 'HPSC Haryana Civil Services (HCS) Examination', shortName: 'HPSC HCS',
    authority: 'Haryana Public Service Commission', category: 'other-states', state: 'Haryana',
    description: 'Haryana civil services via Prelims, Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'HPSC official website', url: 'https://hpsc.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Single GS paper: 100 questions, 2 hours, negative marking 0.25.', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
  {
    slug: 'jpsc-cce', name: 'JPSC Combined Civil Services Examination', shortName: 'JPSC CCE',
    authority: 'Jharkhand Public Service Commission', category: 'other-states', state: 'Jharkhand',
    description: 'Jharkhand state civil services via Prelims, Mains and Interview.',
    syllabusStatus: 'UNVERIFIED',
    contentNote: 'Structure recorded; shares core GS content.',
    sourceRefs: [{ label: 'JPSC official website', url: 'https://jpsc.gov.in' }],
    stages: [
      { slug: 'prelims', name: 'Prelims', paperNote: 'Two papers: GS Paper 1 (100 Q/200 marks) and Paper 2 (100 Q/200 marks, Jharkhand-specific).', subjects: [
        { slug: 'gs', name: 'General Studies', units: [historyUnitTn(), polityUnit(), geographyUnit(), economyUnit(), scienceUnit(), currentEventsUnit()] },
      ] },
      { slug: 'mains', name: 'Mains & Interview', subjects: [] },
    ],
  },
]
