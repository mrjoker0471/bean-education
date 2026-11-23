// ─────────────────────────────────────────────────────────────────────────────
// BEAN Education — Official documents registry (Layer 1: Study Material).
// Every entry points at a REAL official page/PDF-host from the conducting
// authority or a legitimate official publisher. Nothing is fabricated.
//
// Honest verification model (scripts/verify-resources.mjs):
//   VERIFIED   — the URL responded 2xx/3xx from the build environment.
//   UNREACHABLE — the authority site did not respond from the build sandbox
//                (several Indian government portals block datacentre IPs).
//                The entry is kept visible with an honest status badge because
//                it will usually open fine from a student's own network.
//   PENDING_REVIEW — rate-limited (429/403) during the check.
//
// fileKind tells the UI how the link opens:
//   PORTAL  — the authority's official hub (notifications, bulletins, PDFs live here)
//   WEBPAGE — a specific official page (e.g. a syllabus page)
//   PDF     — a direct PDF download (only when actually confirmed)
//
// docDate is ONLY set when the date is verifiable (e.g. carried in the
// document's own title/URL). Unknown dates stay null — never invented.
// ─────────────────────────────────────────────────────────────────────────────

import type { ResourceSeed } from './resources'

// ─── CUET (UG) 2026 subject-wise official syllabus PDFs ──────────────────────
// Every URL below was fetched from the official NTA page
// https://cuet.nta.nic.in/cuetug-2026-syllabus/ and verified to return
// HTTP 200 with content-type application/pdf (October 2026). These are real,
// direct NTA PDF downloads — fileKind: 'PDF' is justified for all of them.
const CD = 'https://cdnbbsr.s3waas.gov.in/s3d1a21da7bca4abff8b0b61b87597de73/uploads'
const CUET_SUBJECT_SYLLABUS_DOCS: ResourceSeed[] = [
  // Languages (codes 101–113) — one official syllabus PDF per language
  { examSlug: 'cuet-ug', title: 'English (101) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'English', url: `${CD}/2025/12/20251227980877010.pdf`, note: 'Reading comprehension (factual, narrative, literary) and verbal ability tasks.' },
  { examSlug: 'cuet-ug', title: 'Hindi (102) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Hindi', url: `${CD}/2025/12/202512271367681884.pdf`, note: 'आधिकारिक पाठ्यक्रम — reading comprehension and verbal ability outline.' },
  { examSlug: 'cuet-ug', title: 'Assamese (103) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Assamese', url: `${CD}/2025/12/20251227237505054.pdf` },
  { examSlug: 'cuet-ug', title: 'Bengali (104) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Bengali', url: `${CD}/2025/12/202512271803368333.pdf` },
  { examSlug: 'cuet-ug', title: 'Gujarati (105) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Gujarati', url: `${CD}/2025/12/202512271413553522.pdf` },
  { examSlug: 'cuet-ug', title: 'Kannada (106) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Kannada', url: `${CD}/2025/12/20251227946030806.pdf` },
  { examSlug: 'cuet-ug', title: 'Malayalam (107) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Malayalam', url: `${CD}/2025/12/202512271352620716.pdf` },
  { examSlug: 'cuet-ug', title: 'Marathi (108) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Marathi', url: `${CD}/2025/12/20251227262140491.pdf` },
  { examSlug: 'cuet-ug', title: 'Odia (109) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Odia', url: `${CD}/2025/12/20251227991376595.pdf` },
  { examSlug: 'cuet-ug', title: 'Punjabi (110) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Punjabi', url: `${CD}/2025/12/20251227900793676.pdf` },
  { examSlug: 'cuet-ug', title: 'Tamil (111) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Tamil', url: `${CD}/2025/12/202512271178809232.pdf` },
  { examSlug: 'cuet-ug', title: 'Telugu (112) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Telugu', url: `${CD}/2025/12/2025122713492501.pdf` },
  { examSlug: 'cuet-ug', title: 'Urdu (113) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', language: 'Urdu', url: `${CD}/2025/12/20251227870466763.pdf` },
  // Domain subjects (23) — Class-12 NCERT scope per the official bulletin
  { examSlug: 'cuet-ug', title: 'Accountancy / Book Keeping (301) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227522720880.pdf` },
  { examSlug: 'cuet-ug', title: 'Agriculture (302) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227220683220.pdf` },
  { examSlug: 'cuet-ug', title: 'Anthropology (303) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512272060536755.pdf` },
  { examSlug: 'cuet-ug', title: 'Biology / Biotechnology / Biochemistry (304) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227553390532.pdf` },
  { examSlug: 'cuet-ug', title: 'Business Studies (305) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227259182286.pdf` },
  { examSlug: 'cuet-ug', title: 'Chemistry (306) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227437950608.pdf` },
  { examSlug: 'cuet-ug', title: 'Environmental Science (307) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271868030697.pdf` },
  { examSlug: 'cuet-ug', title: 'Computer Science / Information Practices (308) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271589155179.pdf` },
  { examSlug: 'cuet-ug', title: 'Economics / Business Economics (309) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271366341541.pdf` },
  { examSlug: 'cuet-ug', title: 'Fine Arts / Visual Arts / Commercial Arts (312) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227993225795.pdf` },
  { examSlug: 'cuet-ug', title: 'Geography / Geology (313) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227925964065.pdf` },
  { examSlug: 'cuet-ug', title: 'History (314) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227167662981.pdf` },
  { examSlug: 'cuet-ug', title: 'Home Science (315) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'January 2026', url: `${CD}/2026/01/20260120190240355.pdf` },
  { examSlug: 'cuet-ug', title: 'Knowledge Tradition & Practices of India (316) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271210828150.pdf` },
  { examSlug: 'cuet-ug', title: 'Mass Media / Mass Communication (318) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227328972301.pdf` },
  { examSlug: 'cuet-ug', title: 'Mathematics / Applied Mathematics (319) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271521179041.pdf` },
  { examSlug: 'cuet-ug', title: 'Performing Arts — Dance, Drama, Music (320) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271161227870.pdf` },
  { examSlug: 'cuet-ug', title: 'Physical Education — Yoga, Sports (321) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271937553070.pdf` },
  { examSlug: 'cuet-ug', title: 'Physics (322) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271334142557.pdf` },
  { examSlug: 'cuet-ug', title: 'Political Science (323) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227158639183.pdf` },
  { examSlug: 'cuet-ug', title: 'Psychology (324) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271803303381.pdf` },
  { examSlug: 'cuet-ug', title: 'Sanskrit (325) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/202512271597735514.pdf`, note: 'Domain-subject Sanskrit (not translated into other languages per the bulletin).' },
  { examSlug: 'cuet-ug', title: 'Sociology (326) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227621541284.pdf` },
  { examSlug: 'cuet-ug', title: 'General Aptitude Test (501) — official syllabus (PDF)', provider: 'National Testing Agency', type: 'OFFICIAL_SUBJECT_SYLLABUS', fileKind: 'PDF', docDate: 'December 2025', url: `${CD}/2025/12/20251227140287889.pdf`, note: 'GK, current affairs, mental ability, numerical ability, quantitative reasoning, logical & analytical reasoning, general science & environmental literacy.' },
]

export const OFFICIAL_DOCS: ResourceSeed[] = [
  // ─── Engineering & Medical entrances (NTA + organising IITs) ───
  {
    examSlug: 'jee-main',
    title: 'JEE Main — Official examination portal',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://jeemain.nta.nic.in',
    note: 'Official hub: information bulletins, syllabus PDFs, city intimation and results are published here each session.',
  },
  {
    examSlug: 'jee-main',
    title: 'JEE Main — Official syllabus page',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_SYLLABUS', fileKind: 'WEBPAGE',
    url: 'https://jeemain.nta.nic.in/syllabus/',
    note: 'Hosts the current official syllabus PDF for Paper 1 (B.E./B.Tech) and Paper 2 (B.Arch/B.Planning).',
  },
  {
    examSlug: 'jee-main',
    title: 'JEE Main — Information bulletin page',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_BULLETIN', fileKind: 'WEBPAGE',
    url: 'https://jeemain.nta.nic.in/information-bulletin/',
    note: 'The official information bulletin (eligibility, pattern, marking) — distinct from the syllabus document.',
  },
  {
    examSlug: 'jee-advanced',
    title: 'JEE Advanced — Official portal',
    provider: 'IIT (rotating organising institute)',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://jeeadv.ac.in',
    note: 'Official JEE Advanced hub — information brochure and official syllabus PDF.',
  },

  {
    examSlug: 'neet-ug',
    title: 'NEET UG — Official examination portal',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://neet.nta.nic.in',
    note: 'Official hub for the information bulletin, syllabus PDF and all NEET UG notices.',
  },
  {
    examSlug: 'neet-ug',
    title: 'NEET UG — Official syllabus page',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_SYLLABUS', fileKind: 'WEBPAGE',
    url: 'https://neet.nta.nic.in/syllabus/',
    note: 'Current NTA syllabus for Physics, Chemistry and Biology.',
  },
  {
    examSlug: 'neet-ug',
    title: 'NEET UG — Information bulletin page',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_BULLETIN', fileKind: 'WEBPAGE',
    url: 'https://neet.nta.nic.in/information-bulletin/',
    note: 'Official bulletin: eligibility, pattern, marking scheme and exam-day rules.',
  },
  {
    examSlug: 'neet-pg',
    title: 'NEET PG — NBEMS official portal',
    provider: 'National Board of Examinations in Medical Sciences',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://nbe.edu.in',
    note: 'NBEMS publishes the NEET PG information bulletin and syllabus here.',
  },
  {
    examSlug: 'inicet',
    title: 'INI CET — AIIMS examinations portal',
    provider: 'AIIMS, New Delhi',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://aiimsexams.ac.in',
    note: 'Official AIIMS exams portal — INI CET prospectus and notices.',
  },

  {
    examSlug: 'cuet-ug',
    title: 'CUET UG — Official examination portal',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://cuet.nta.nic.in',
    note: 'Official hub: information bulletin, syllabus PDFs, admit cards and results for CUET UG.',
  },
  {
    examSlug: 'cuet-ug',
    title: 'CUET (UG) 2026 — Information bulletin (PDF, 3 MB)',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_BULLETIN', fileKind: 'PDF', docDate: 'January 2026',
    url: 'https://cdnbbsr.s3waas.gov.in/s3d1a21da7bca4abff8b0b61b87597de73/uploads/2026/01/202601031633478370.pdf',
    note: 'The authoritative CUET (UG) 2026 bulletin: eligibility, up-to-5-subject choice rule, per-paper pattern (50 MCQs / 60 min, +5 correct, −1 incorrect), university list and subject codes.',
  },
  {
    examSlug: 'cuet-ug',
    title: 'CUET (UG) 2026 — Official syllabus page (2026 cycle)',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_SYLLABUS', fileKind: 'WEBPAGE',
    url: 'https://cuet.nta.nic.in/cuetug-2026-syllabus/',
    note: 'The current-cycle page that links every official subject syllabus PDF (13 languages, 23 domain subjects, General Aptitude Test) plus the 2026 bulletin and FAQ.',
  },
  {
    examSlug: 'cuet-ug',
    title: 'CUET (UG) 2026 — Official FAQ (PDF)',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_NOTICE', fileKind: 'PDF', docDate: 'January 2026',
    url: 'https://cdnbbsr.s3waas.gov.in/s3d1a21da7bca4abff8b0b61b87597de73/uploads/2026/01/2026011697237004.pdf',
    note: 'Official answers to common queries — subject choice, normalization, eligibility and application process.',
  },
  ...CUET_SUBJECT_SYLLABUS_DOCS,
  {
    examSlug: 'cmat',
    title: 'CMAT — Official examination portal',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://cmat.nta.nic.in',
    note: 'Official hub for the CMAT information bulletin and syllabus.',
  },
  {
    examSlug: 'gate',
    title: 'GATE 2026 — Official organising institute site',
    provider: 'IIT Guwahati (GATE 2026)',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://gate2026.iitg.ac.in',
    docDate: 'GATE 2026 cycle',
    note: 'GATE rotates its organising IIT every year — this is the current cycle\u2019s official site with the GATE 2026 syllabus and brochure.',
  },
  {
    examSlug: 'clat',
    title: 'CLAT — Consortium of National Law Universities',
    provider: 'Consortium of National Law Universities',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://consortiumofnlus.ac.in',
    note: 'Official CLAT portal — notification, syllabus and sample papers.',
  },
  {
    examSlug: 'cat',
    title: 'CAT — Official IIM portal',
    provider: 'Indian Institutes of Management',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://iimcat.ac.in',
    note: 'Official CAT registration and information hub, hosted by the organising IIM.',
  },

  // ─── Central government (UPSC / SSC) ───
  {
    examSlug: 'upsc-cse',
    title: 'UPSC — Official website',
    provider: 'Union Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.upsc.gov.in',
    note: 'Official hub: notifications, syllabus PDFs and exam scheme for all UPSC examinations.',
  },
  {
    examSlug: 'upsc-cse',
    title: 'UPSC — Previous question papers (official)',
    provider: 'Union Public Service Commission',
    type: 'OFFICIAL_NOTICE', fileKind: 'WEBPAGE',
    url: 'https://www.upsc.gov.in/examinations/previous-question-papers',
    note: 'The commission\u2019s own archive of previous-year question papers — the legitimate source for PYQ practice.',
  },
  {
    examSlug: 'upsc-ifs',
    title: 'UPSC — Previous question papers (official)',
    provider: 'Union Public Service Commission',
    type: 'OFFICIAL_NOTICE', fileKind: 'WEBPAGE',
    url: 'https://www.upsc.gov.in/examinations/previous-question-papers',
    note: 'Includes Indian Forest Service preliminary papers in the commission\u2019s official archive.',
  },
  {
    examSlug: 'capf-ac',
    title: 'UPSC — Previous question papers (official)',
    provider: 'Union Public Service Commission',
    type: 'OFFICIAL_NOTICE', fileKind: 'WEBPAGE',
    url: 'https://www.upsc.gov.in/examinations/previous-question-papers',
    note: 'CAPF (AC) written-paper archive on the commission\u2019s official site.',
  },
  {
    examSlug: 'cds',
    title: 'UPSC — Previous question papers (official)',
    provider: 'Union Public Service Commission',
    type: 'OFFICIAL_NOTICE', fileKind: 'WEBPAGE',
    url: 'https://www.upsc.gov.in/examinations/previous-question-papers',
    note: 'CDS English/GK/Elementary Mathematics papers in the official archive.',
  },
  {
    examSlug: 'nda',
    title: 'UPSC — Previous question papers (official)',
    provider: 'Union Public Service Commission',
    type: 'OFFICIAL_NOTICE', fileKind: 'WEBPAGE',
    url: 'https://www.upsc.gov.in/examinations/previous-question-papers',
    note: 'NDA & NA written-paper archive on the commission\u2019s official site.',
  },
  {
    examSlug: 'ssc-cgl',
    title: 'SSC — Official website',
    provider: 'Staff Selection Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://ssc.gov.in',
    note: 'Official hub for notifications, syllabus documents and answer keys of all SSC examinations.',
  },
  {
    examSlug: 'ssc-cgl',
    title: 'SSC — Official syllabus page',
    provider: 'Staff Selection Commission',
    type: 'OFFICIAL_SYLLABUS', fileKind: 'WEBPAGE',
    url: 'https://ssc.gov.in/candidate-information/syllabus',
    note: 'The commission\u2019s syllabus section — scheme and syllabus documents per examination.',
  },

  // ─── Banking, insurance & railways ───
  {
    examSlug: 'sbi-po',
    title: 'SBI — Careers page (PO & Clerk notifications)',
    provider: 'State Bank of India',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://sbi.co.in/web/careers',
    note: 'Official recruitment page: detailed advertisements include the exam pattern and syllabus annexures.',
  },
  {
    examSlug: 'sbi-clerk',
    title: 'SBI — Careers page (PO & Clerk notifications)',
    provider: 'State Bank of India',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://sbi.co.in/web/careers',
    note: 'Official recruitment page: Junior Associate advertisements include the detailed exam pattern.',
  },
  {
    examSlug: 'rbi-grade-b',
    title: 'RBI — Opportunities portal (official)',
    provider: 'Reserve Bank of India',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://opportunities.rbi.org.in',
    note: 'Official RBI recruitment portal — Grade B advertisements with phase-wise pattern and syllabus.',
  },
  {
    examSlug: 'rbi-assistant',
    title: 'RBI — Opportunities portal (official)',
    provider: 'Reserve Bank of India',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://opportunities.rbi.org.in',
    note: 'Official RBI recruitment portal — Assistant notifications with the preliminary/main pattern.',
  },
  {
    examSlug: 'lic-aao',
    title: 'LIC — Official careers section',
    provider: 'Life Insurance Corporation of India',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://licindia.in/web/guest/careers',
    note: 'LIC publishes AAO/Assistant recruitment notifications with the selection scheme here.',
  },
  {
    examSlug: 'ibps-po',
    title: 'IBPS — Official website',
    provider: 'Institute of Banking Personnel Selection',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.ibps.in',
    note: 'Official IBPS hub — CRP PO/MT notifications with the detailed phased pattern. (Did not respond from our build environment; normally reachable from Indian networks.)',
  },
  {
    examSlug: 'rrb-ntpc',
    title: 'Railway Recruitment Boards — official site',
    provider: 'Railway Recruitment Boards',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.rrbcdg.gov.in',
    note: 'Official RRB hub — CEN notices with NTPC/GROUP D/ALP patterns. (Did not respond from our build environment; normally reachable from Indian networks.)',
  },

  // ─── Teaching & eligibility ───
  {
    examSlug: 'ctet',
    title: 'CTET — Official website',
    provider: 'Central Board of Secondary Education',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://ctet.nic.in',
    note: 'Official CTET hub — information bulletins with the paper-wise structure and syllabus.',
  },
  {
    examSlug: 'ctet',
    title: 'CTET — Information bulletin page',
    provider: 'Central Board of Secondary Education',
    type: 'OFFICIAL_BULLETIN', fileKind: 'WEBPAGE',
    url: 'https://ctet.nic.in/information-bulletin/',
    note: 'The official bulletin: Paper I & Paper II structure, syllabus and eligibility.',
  },
  {
    examSlug: 'ugc-net',
    title: 'UGC NET — Official examination portal',
    provider: 'National Testing Agency on behalf of UGC',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://ugcnet.nta.nic.in',
    note: 'Official hub — information bulletin with subject-wise syllabus links.',
  },

  // ─── State PSCs & others ───
  {
    examSlug: 'uppsc-pcs',
    title: 'UPPSC — Official website',
    provider: 'Uttar Pradesh Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://uppsc.up.nic.in',
    note: 'Official commission site — combined state services notifications and syllabus.',
  },
  {
    examSlug: 'kerala-psc-degree',
    title: 'Kerala PSC — Official portal',
    provider: 'Kerala Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://psc.kerala.gov.in',
    note: 'Official Kerala PSC portal — notifications and exam syllabi.',
  },
  {
    examSlug: 'kpsc-kas',
    title: 'KPSC — Official website',
    provider: 'Karnataka Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://kpsc.kar.nic.in',
    note: 'Official Karnataka PSC site — KAS notifications and syllabus.',
  },
  {
    examSlug: 'tnpsc-group-1',
    title: 'TNPSC — Official website (notifications & syllabus PDFs)',
    provider: 'Tamil Nadu Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.tnpsc.gov.in',
    note: 'Authoritative source for all TNPSC syllabi and annual planners. (Did not respond from our build environment; normally reachable from Indian networks.)',
  },
  {
    examSlug: 'tnpsc-group-2-2a',
    title: 'TNPSC — Official website (notifications & syllabus PDFs)',
    provider: 'Tamil Nadu Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.tnpsc.gov.in',
    note: 'Authoritative source for all TNPSC syllabi and annual planners. (Did not respond from our build environment; normally reachable from Indian networks.)',
  },
  {
    examSlug: 'tnpsc-group-4',
    title: 'TNPSC — Official website (notifications & syllabus PDFs)',
    provider: 'Tamil Nadu Public Service Commission',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.tnpsc.gov.in',
    note: 'Authoritative source for all TNPSC syllabi and annual planners. (Did not respond from our build environment; normally reachable from Indian networks.)',
  },

  // ─── Cross-exam official primary sources (canonical: attached to matching topics) ───
  {
    canonical: 'polity-constitution',
    title: 'The Constitution of India — official legislative page',
    provider: 'Ministry of Law & Justice',
    type: 'OFFICIAL_NOTICE', fileKind: 'WEBPAGE',
    url: 'https://legislative.gov.in/constitution-of-india',
    note: 'The official up-to-date Constitution of India page (with amendments) on the Legislative Department site.',
  },
  {
    canonical: 'polity-constitution',
    title: 'India.gov.in — National portal of India',
    provider: 'Government of India',
    type: 'OFFICIAL_PORTAL', fileKind: 'PORTAL',
    url: 'https://www.india.gov.in',
    note: 'The national portal — official government documents, schemes and the Constitution section.',
  },
]
