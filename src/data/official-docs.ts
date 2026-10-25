// ─────────────────────────────────────────────────────────────────────────────
// BEAN EXAMS — Official documents registry (Layer 1: Study Material).
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
    note: 'Official hub: information bulletin and test structure for CUET UG.',
  },
  {
    examSlug: 'cuet-ug',
    title: 'CUET UG — Official syllabus page',
    provider: 'National Testing Agency',
    type: 'OFFICIAL_SYLLABUS', fileKind: 'WEBPAGE',
    url: 'https://cuet.nta.nic.in/syllabus/',
    note: 'Section-wise test structure and syllabus documents.',
  },
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
