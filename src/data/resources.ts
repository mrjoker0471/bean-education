// ─────────────────────────────────────────────────────────────────────────────
// BEAN Education — Curated learning resources (canonical library).
// Verification statuses are assigned by scripts/verify-resources.mjs based on
// REAL in-session HTTP checks. Nothing is marked VERIFIED unless it responded
// during the build. Government portals unreachable from the build environment
// are kept but honestly labelled UNREACHABLE / PENDING_REVIEW.
// ─────────────────────────────────────────────────────────────────────────────

export type ResourceType =
  | 'OFFICIAL_SYLLABUS' | 'OFFICIAL_SUBJECT_SYLLABUS' | 'OFFICIAL_BULLETIN' | 'OFFICIAL_PORTAL' | 'OFFICIAL_NOTICE'
  | 'TEXTBOOK_PDF' | 'STUDY_NOTES' | 'ARTICLE' | 'VIDEO' | 'REVISION' | 'ORIGINAL_GUIDE'

export type ResourceFileKind = 'PORTAL' | 'WEBPAGE' | 'PDF'

export interface ResourceSeed {
  canonical?: string
  examSlug?: string
  title: string
  provider: string
  type: ResourceType
  url: string
  language?: string
  accessType?: 'FREE' | 'REGISTRATION' | 'PAID'
  attribution?: string
  note?: string
  fileKind?: ResourceFileKind // how the link opens — PORTAL/WEBPAGE open as pages, PDF downloads
  docDate?: string // publication/revision date, only when verifiably known
}

export const RESOURCES: ResourceSeed[] = [
  // Polity
  { canonical: 'polity-constitution', title: 'Constitution of India — overview & history', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Constitution_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-constitution', title: 'The Constitution of India (National Portal)', provider: 'india.gov.in', type: 'STUDY_NOTES', url: 'https://www.india.gov.in/my-government/constitution-india', note: 'Official portal page; primary source for full text links.' },
  { canonical: 'polity-fundamental-rights', title: 'Fundamental Rights in India — detailed article', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Fundamental_Rights_in_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-union-executive', title: 'President of India — election, powers, tenure', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/President_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-parliament', title: 'Parliament of India — structure & functions', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Parliament_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-judiciary', title: 'Supreme Court of India — jurisdiction & history', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Supreme_Court_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-panchayati-raj', title: 'Panchayati Raj in India — 73rd Amendment explained', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Panchayati_raj_in_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-constitutional-bodies', title: 'Comptroller and Auditor General of India', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Comptroller_and_Auditor_General_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-tn-administration', title: 'Government of Tamil Nadu — structure', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Government_of_Tamil_Nadu', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'polity-tn-administration', title: 'TNPSC — official website (notifications & syllabus PDFs)', provider: 'TNPSC', type: 'STUDY_NOTES', url: 'https://www.tnpsc.gov.in', note: 'Authoritative source for TNPSC syllabi; unreachable from the build sandbox — status pending field verification.' },

  // History
  { canonical: 'history-ancient', title: 'Indus Valley Civilisation', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Indus_Valley_Civilisation', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'history-ancient', title: 'Maurya Empire', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Maurya_Empire', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'history-medieval', title: 'Delhi Sultanate', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Delhi_Sultanate', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'history-modern', title: 'Indian independence movement — timeline', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Indian_independence_movement', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'history-tn', title: 'Chola dynasty — temples, navy & administration', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Chola_dynasty', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'history-tn', title: 'Great Living Chola Temples (UNESCO)', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Great_Living_Chola_Temples', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'history-national-movement', title: 'Indian National Congress — sessions & leaders', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Indian_National_Congress', attribution: 'Wikipedia contributors (CC BY-SA)' },

  // Geography
  { canonical: 'geography-india', title: 'Geography of India — relief, rivers, climate', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Geography_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'geography-tn', title: 'Geography of Tamil Nadu', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Geography_of_Tamil_Nadu', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'geography-world', title: 'Geography — continents, oceans & lines', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Geography', attribution: 'Wikipedia contributors (CC BY-SA)' },

  // Economy & banking
  { canonical: 'economy-basics', title: 'Economy of India — structure & reforms', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Economy_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'economy-basics', title: 'Government schemes & press releases', provider: 'Press Information Bureau', type: 'ARTICLE', url: 'https://pib.gov.in', note: 'Primary official source for scheme launches and updates.' },
  { canonical: 'economy-banking', title: 'Reserve Bank of India — history & functions', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Reserve_Bank_of_India', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'economy-banking', title: 'RBI — official opportunities portal (circulars, FAQs)', provider: 'Reserve Bank of India', type: 'STUDY_NOTES', url: 'https://opportunities.rbi.org.in', note: 'Official RBI recruitment portal.' },
  { canonical: 'economy-tn', title: 'Economy of Tamil Nadu', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Economy_of_Tamil_Nadu', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'banking-awareness', title: 'IBPS — official website (notifications & FAQs)', provider: 'IBPS', type: 'STUDY_NOTES', url: 'https://www.ibps.in', note: 'Authoritative for banking recruitment patterns.' },

  // Science & environment
  { canonical: 'science-physics', title: 'Physics — core concepts', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Physics', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'science-chemistry', title: 'Chemistry — core concepts', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Chemistry', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'science-biology', title: 'Human body — systems overview', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Human_body', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'science-space', title: 'Solar System', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Solar_System', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'environment', title: 'Biodiversity — hotspots & conservation', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Biodiversity', attribution: 'Wikipedia contributors (CC BY-SA)' },

  // Current affairs
  { canonical: 'current-affairs', title: 'Current affairs coverage (exam-oriented)', provider: 'GKToday', type: 'ARTICLE', url: 'https://www.gktoday.in', note: 'Free current-affairs digest; verify every fact against official releases.' },
  { canonical: 'current-affairs', title: 'UPSC preparation articles & analysis', provider: 'Drishti IAS', type: 'ARTICLE', url: 'https://www.drishtiias.com', note: 'Widely used free prep portal.' },

  // Aptitude / reasoning / english
  { canonical: 'aptitude-percentages', title: 'Percentage — worked problems', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Percentage', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'aptitude-data-interpretation', title: 'Chart types & data visualisation basics', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Chart', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'english-grammar', title: 'English grammar — tense reference', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Grammatical_tense', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'english-comprehension', title: 'Reading comprehension practice resources', provider: 'Jagran Josh', type: 'ARTICLE', url: 'https://www.jagranjosh.com', note: 'Free exam-prep articles across subjects.' },

  // STEM foundations (NEET/JEE)
  { canonical: 'neet-bio-cell', title: 'Cell biology — structure & organelles', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Cell_(biology)', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'neet-bio-human-physiology', title: 'Respiratory system — gas exchange', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Respiratory_system', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'neet-chem-mole-concept', title: 'Mole (unit) & stoichiometry', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Mole_(unit)', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'neet-physics-kinematics', title: 'Kinematics — equations of motion', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Kinematics', attribution: 'Wikipedia contributors (CC BY-SA)' },
  { canonical: 'math-quadratic', title: 'Quadratic equation — roots & discriminant', provider: 'Wikipedia', type: 'ARTICLE', url: 'https://en.wikipedia.org/wiki/Quadratic_equation', attribution: 'Wikipedia contributors (CC BY-SA)' },

  // STEM video lessons
  { canonical: 'science-physics', title: 'NPTEL video courses — physics basics', provider: 'NPTEL (IITs & IISc)', type: 'VIDEO', url: 'https://nptel.ac.in/courses', accessType: 'REGISTRATION', note: 'Free government MOOC platform; enrolment required for certificates.' },
  { canonical: 'neet-bio-cell', title: 'SWAYAM free courses — biology', provider: 'SWAYAM (MoE)', type: 'VIDEO', url: 'https://swayam.gov.in', accessType: 'REGISTRATION', note: 'Free official MOOCs from Indian universities.' },

  // Public-domain textbook archive
  { canonical: 'history-modern', title: 'Public-domain history texts (Internet Archive)', provider: 'Internet Archive', type: 'TEXTBOOK_PDF', url: 'https://archive.org/details/texts', note: 'Search for out-of-copyright Indian history volumes; availability varies per item.' },
]

// Exam-level official portals (kept for navigation; statuses set by verifier)
export const EXAM_RESOURCES: ResourceSeed[] = [
  { examSlug: 'tnpsc-group-1', title: 'TNPSC — Group 1 notifications & syllabus', provider: 'TNPSC', type: 'STUDY_NOTES', url: 'https://www.tnpsc.gov.in' },
  { examSlug: 'upsc-cse', title: 'UPSC — Civil Services examination page', provider: 'UPSC', type: 'STUDY_NOTES', url: 'https://upsc.gov.in' },
  { examSlug: 'ssc-cgl', title: 'SSC — official website', provider: 'SSC', type: 'STUDY_NOTES', url: 'https://ssc.gov.in' },
  { examSlug: 'ibps-po', title: 'IBPS — PO/MT recruitment page', provider: 'IBPS', type: 'STUDY_NOTES', url: 'https://www.ibps.in' },
  { examSlug: 'rrb-ntpc', title: 'Railway Recruitment Boards — official site', provider: 'RRBs', type: 'STUDY_NOTES', url: 'https://www.rrbcdg.gov.in' },
  { examSlug: 'neet-ug', title: 'NTA NEET — information bulletins', provider: 'NTA', type: 'STUDY_NOTES', url: 'https://neet.nta.nic.in' },
  { examSlug: 'sbi-po', title: 'SBI Careers — PO notifications', provider: 'SBI', type: 'STUDY_NOTES', url: 'https://sbi.co.in/web/careers' },
  { examSlug: 'ctet', title: 'CTET — official website', provider: 'CBSE', type: 'STUDY_NOTES', url: 'https://ctet.nic.in' },
]
