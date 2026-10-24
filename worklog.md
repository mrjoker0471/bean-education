# BEAN EXAMS — Shared Worklog

All agents MUST read this file before working and append their section after finishing a Task ID.

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Inspect repository, establish checkpoint, inventory existing features.

Work Log:
- Inspected /home/z/my-project: Next.js 16.1.3 (App Router, Turbopack), TypeScript 5, Tailwind CSS 4, shadcn/ui (New York) components already in src/components/ui, Prisma 6 + SQLite (DATABASE_URL=file:/home/z/my-project/db/custom.db), bun as runtime/package manager.
- IMPORTANT FINDING: The repository is a FRESH SCAFFOLD. There is no pre-existing BEAN EXAMS code: src/app/page.tsx is the default Z.ai logo page, prisma/schema.prisma has only placeholder User/Post models. No exam/subject/question data, no BEAN Intelligence, no auth flows exist yet.
- Decision: build the full BEAN EXAMS platform in this repo per the user's build spec (black-and-gold design system, all-India exam catalogue, three-layer learning system, BEAN Intelligence via z-ai-web-dev-sdk backend).
- Network verification probe results (for resource verification): reachable — en.wikipedia.org (200), india.gov.in (200), pib.gov.in (200), archive.org (200), gktoday.in (200), jagranjosh.com (200), drishtiias.com (200), swayam.gov.in (200), nptel.ac.in (200), oli.cmu.edu (200). NOT reachable from sandbox — ncert.nic.in (000), tnpsc.gov.in (000), britannica.com (403), hi/ta.wikipedia.org (429 rate limit). Resource statuses will be set honestly based on in-session verification only.
- Git checkpoint created: commit "checkpoint: initial scaffold before BEAN EXAMS build" (parent: 90c3c70 Initial commit). Recoverable via `git log`.
- Dev server already running on port 3000 (bun run dev), logs at /home/z/my-project/dev.log.

Stage Summary:
- Stack confirmed. Scaffold-only starting point. Checkpoint at git commit before changes. Resource verification strategy: only in-session verified URLs get VERIFIED status; blocked domains get UNREACHABLE/PENDING_REVIEW. Single source of truth = SQLite via Prisma; seed data lives in src/data/* and is imported idempotently by prisma/seed.ts.

## Architecture contract (binding for all later agents)

- Multi-page platform rendered as an SPA at the single visible route `/` (src/app/page.tsx) with hash deep-links: `#/`, `#/catalog`, `#/exam/<slug>`, `#/topic/<id>`, `#/test/<attemptId>`, `#/result/<attemptId>`, `#/bean`, `#/progress`. No other page routes.
- API routes (allowed): /api/catalog, /api/exams, /api/exams/[slug], /api/topics/[id], /api/tests/start, /api/attempts/[id] (GET/POST submit), /api/progress, /api/bean/chat. Next 16: params are Promises (await them).
- Guest identity: localStorage "bean_guest_id" (uuid) sent as query/body param; attempts scoped by guestId. No auth system in this build (guest-first), consistent behaviour everywhere.
- Test engine is server-authoritative: start returns questions WITHOUT correctIndex; submit scores server-side from Question.correctIndex; TIMED_OUT if past server endsAt + 120s grace.
- Design tokens in src/app/globals.css: bg #070707, surface #111111, elevated #151515, border #262626, gold #D6A514 / hover #E5B92A, text #F5F5F5, secondary #A6A6A6. Serif display font (Playfair Display) + Geist sans. Gold = gold/gold-foreground Tailwind tokens; no indigo/blue.
- State: zustand store at src/lib/store.ts (route, guestId, bean settings). Data fetching via fetch + TanStack Query where useful.

---
Task ID: 2-a…2-f (data layer)
Agent: main (Z.ai Code)
Task: Schema, catalogue seed, notes library, question bank, resources + verification, idempotent seeding.

Work Log:
- prisma/schema.prisma: Category, Exam, Stage, Subject, Unit, Topic, Note, Resource, Question, TestTemplate, Attempt (SQLite-safe, JSON-in-String, deterministic ids). db push OK.
- src/data/exams.ts: 10 categories, 77 real exams with conducting authorities; deep syllabus trees (stages→subjects→units→topics with canonicalSlug mapping) for TNPSC G1/G2/G4, UPSC CSE, SSC CGL/CHSL, IBPS/SBI PO, RRB NTPC, NEET UG, NDA, CDS, CAPF, state PSCs; patterns only where well-established; syllabusStatus honest (PARTIAL/UNVERIFIED everywhere — official PDFs unreachable from sandbox).
- src/data/notes-gs.ts + notes-apt.ts: 54 original study notes (9-part structure: concept→definitions→facts→examples→formulas→mistakes→revision→references→related questions) keyed by canonical slug.
- src/data/questions.ts: ~240 original practice MCQs (all sourceType=ORIGINAL, author-verified answers + explanations; NO fabricated PYQ provenance). Fixed 6 numerically ambiguous questions during authoring.
- src/data/resources.ts: 51 curated resources; scripts/verify-resources.mjs performs REAL HTTP checks → src/data/resource-verification.json. Result: 39 VERIFIED (200), 5 UNREACHABLE (upsc.gov.in, tnpsc.gov.in, rrbcdg.gov.in, tnusrb.tn.gov.in, nabard timeouts), 7 PENDING_REVIEW (403/429 bot-blocks). Seeder stores these statuses verbatim.
- prisma/seed.ts: idempotent upserts by deterministic ids. RAN TWICE: PASS1 == PASS2 exactly. Integrity: 0 duplicate topics/exams/questions/resources, 0 orphan questions.
- Final DB: 10 categories, 77 exams, 134 stages, 203 subjects, 383 units, 1828 topics, 1778 note links (54 unique notes attached by canonical mapping), 8737 question rows (canonical library attached per exam — cross-exam sharing is by design; deterministic ids prevent accidental duplicates), 1308 resource rows, 243 test templates (subject tests + mixed mocks; negative marking inherited from stage patterns).

Stage Summary:
- Single source of truth = SQLite DB. src/data/* = import source (like migrations). Content attach is by canonicalSlug. TNPSC-G1: 233 questions/48 resources/4 templates. UPSC-CSE: 242 questions/4 templates.
