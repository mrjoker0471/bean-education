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

---
Task ID: 3-a/3-b/3-c (foundation)
Agent: main (Z.ai Code)
Task: Design system, SPA shell + hash router, homepage, all API routes.

Work Log:
- globals.css: full black-gold token set (#070707 page, #111111 card, #151515 elevated, #262626 border, #D6A514 gold, #E5B92A hover, #F5F5F5/#A6A6A6 text, muted #C24E4E destructive, #5B9A6E success). Gold available as Tailwind classes: text-gold, bg-gold, border-gold/30, bg-elevated, bg-page, text-success. font-display = Playfair Display serif. Custom scrollbars + .note-markdown styles included.
- layout.tsx: Playfair Display + Geist fonts, dark class fixed, metadata "BEAN EXAMS".
- src/lib/types.ts: ALL DTOs (CatalogResponse, ExamListItem, ExamDetailDTO, TopicDetailDTO, AttemptStateDTO, AttemptResultDTO, ProgressDTO, BeanChatMessage/Context/Settings).
- src/lib/store.ts: zustand store — route parsing/navigate (hash-based deep links), guestId (localStorage bean_guest_id), beanContext, beanSettings (persisted). Helper: navigateExam(slug, tab).
- src/lib/api.ts: typed fetch client (api.catalog/exams/exam/topic/startTest/attemptState/submitAttempt/attemptResult/progress/beanChat).
- src/lib/serialize.ts: server helpers (loadContentMaps, serializeExam, shuffle, safeParse).
- API routes verified live: /api/catalog ✓, /api/exams?search&category&state ✓, /api/exams/[slug] ✓ (stages→subjects→units→topics with per-topic noteAvailable/questionCount/resourceCount, templates, examResources), /api/topics/[id] ✓ (breadcrumbs, note, resources, questionCount, siblings), /api/tests/start ✓ (template|topic|subject|exam filters; resume of unfinished attempts; 409 if <4 questions), /api/attempts/[id] GET+POST ✓ (server-authoritative timer endsAt, auto-TIMED_OUT after +120s grace, answer-injection filtered, idempotent duplicate submit), /api/attempts/[id]/result ✓, /api/progress ✓ (weak topics from perTopicJson, accuracy<60% & total>=2), /api/bean/chat ✓ (ZAI SDK, note excerpt 3500 chars injected, rate limit 20/5min, honest usedContext).
- Homepage built: hero, real debounced search (name/shortName/authority/state/description/category), category grid (real counts), featured cards (honest badges), expandable catalogue accordion (lazy-loads per category), BEAN method 5 steps, CTA. Header/footer done (footer mt-auto sticky-bottom).
- Views NOT yet built (stubs return null): catalog-view, exam-view, topic-view, test-runner-view, result-view, bean-view, progress-view → Tasks 4-a, 4-b, 5-a.

Stage Summary:
- ALL backend + design system + homepage complete and smoke-tested end-to-end (start→submit→result→progress→bean chat all 200 with real data). Note-include on Topic is `notes` (array), not `note`. View files live at src/components/bean/views/*.tsx.

## VIEW CONTRACT (binding for Tasks 4-a/4-b/5-a)

- Read src/lib/types.ts + src/lib/api.ts + src/lib/store.ts first. Use ONLY api.* for data. Use useAppStore for route/guestId: `const guestId = useAppStore(s => s.guestId)`; navigate via `useAppStore.getState().navigate({view:...})` or navigateExam(slug, tab) or `navigate(parseHash('#/exam/'+slug))`. NEVER touch window.location directly (lint rule react-hooks/immutability).
- Design: bg-page bg on view root not needed (shell has it); cards = `border-border bg-card`, elevated = `bg-elevated`, gold CTA = `bg-gold text-primary-foreground hover:bg-gold-hover`, outline-gold = `border-gold/40 text-gold hover:bg-gold/10`. Serif headings: `font-display`. Use shadcn components from '@/components/ui/*'. Use shared components: ExamCard, CountPill, SectionHeading, SyllabusStatusBadge/ResourceStatusBadge/AccessTypeBadge (status-badge.tsx), EmptyState (empty-state.tsx), Markdown (markdown.tsx).
- Props: CatalogView(), ExamView({slug, initialTab?}), TopicView({topicId}), TestRunnerView({attemptId}), ResultView({attemptId}), BeanView({seeded?: boolean}), ProgressView().
- carry beanContext into topic/exam views: useAppStore.getState().setBeanContext({...}) when rendering so #/bean inherits context. To open Bean with context: navigate({view:'bean', seeded:false}).
- Loading: Skeleton components; Errors: red alert box (border-destructive/40 bg-destructive/10 text-destructive role=alert); Empty states: EmptyState. Mobile-first responsive; no horizontal overflow; max-h-96 overflow-y-auto for long lists. No blue/indigo colors. All interactive elements must work.
- Lint with `bun run lint` MUST pass (0 errors) before finishing. Do NOT modify: schema, seed data, api routes, lib files (types/store/api/serialize/db), globals.css, header/footer/page/home. Only your view file(s) + new child components you add under src/components/bean/.
- After finishing, append your worklog section (Task ID 4-a / 4-b / 5-a) and `git add -A && git commit -m "task <id>: ..."`.

---
Task ID: 5-a
Agent: BEAN views agent (Z.ai Code)
Task: BeanView (BEAN Intelligence workspace) + ProgressView (My Progress) implementations.

Work Log:
- bean-view.tsx: full BEAN Intelligence workspace. Header = Sparkles badge + font-display "BEAN Intelligence" + subtitle "Context-aware learning support — grounded in your current topic". Dismissible one-time seeded hint banner ("Context carried over from your last topic") shown only when seeded prop is true.
- Context panel: renders only the fields actually set on useAppStore.beanContext as gold chips (Exam/Stage/Subject/Topic/Note/Question/MCV-options-count/Attempt summary, long values truncated); "Clear context" ghost button → setBeanContext(null); empty-context honest hint (ask BEAN from a topic to attach context); when context.topicId present shows an info line that the topic's study note is provided to the model (matches backend note-excerpt injection).
- Settings row: three shadcn Toggles (Exam-focused/Simple/Detailed) bound to beanSettings.style via setBeanSettings (gold when active via data-[state=on]); Switch bound to beanSettings.showSourceContext labelled "Show what context was used".
- Chat: fixed-height area h-[min(70vh,560px)] with inner overflow-y-auto + ref.scrollTo on new messages/pending. User bubbles right (border-gold/30 bg-gold/10), assistant bubbles left (border-border bg-card) rendered through { Markdown } from '@/components/bean/markdown'; typing indicator (bouncing gold dots) while pending. Empty state shows the exact greeting message + 4 suggested prompts (structure doctrine, 5 percentages questions, current affairs prep, simple vs compound interest) that send immediately. Input + gold Send button in a form (Enter submits), disabled while pending; no Stop button.
- Send flow: pushes user entry, calls api.beanChat({guestId, messages: user/assistant-only history incl. new message, context: beanContext ?? {}, settings: beanSettings}); on success appends assistant reply with usedContext; if showSourceContext, renders tiny muted line "Context used: <fields joined>" or "No topic context attached" when empty. On error appends an inline error bubble (border-destructive/40 bg-destructive/10 text-destructive) showing the server's message (502 → "provider temporarily unavailable" comes straight from the API) with a Retry action that strips error bubbles and re-issues the exact failed payload. Messages are component-local state only (no localStorage). No fake model names; honesty footnote states BEAN cannot browse the web or open files and receives only attached context (+ note excerpt when a topic is set).
- progress-view.tsx: "My Progress" derived only from api.progress(guestId). Four stat cards (Attempts completed / Questions answered / Overall accuracy / Study time) with big font-display gold numbers and honest "—" + explanatory hint when zero/empty. Weak topics card: rows with name, examName, gold Progress bar + accuracy %, question count, outline-gold "Revise topic" → navigate({view:'topic', topicId}); "Ask BEAN for a revision plan" gold button → setBeanContext({attemptSummary: "Weak topics: <name (acc%), …>"}) + navigate({view:'bean', seeded:false}). Empty weak topics → EmptyState (TrendingUp). Attempt history: max-h-96 overflow-y-auto list with title, examLabel, startedAt (en-IN date), SUBMITTED gold / TIMED_OUT destructive-outline / IN_PROGRESS & ABANDONED muted badges, score/maxScore when present, Resume gold button on IN_PROGRESS → navigate({view:'test'}), clicking completed attempts (SUBMITTED or TIMED_OUT — both are terminal states served by /result) → navigate({view:'result'}). Data-honesty banner at bottom: "Progress is derived from your saved attempts on this device (guest session). No activity is fabricated." Loading skeletons; error box (role=alert) + Try again; overall empty state (ClipboardList) with "Browse examinations" action.
- Lint/typing: restructured the progress fetch so setState happens only inside promise callbacks (react-hooks/set-state-in-effect compliant). `bunx eslint` on both files: 0 problems; `bunx tsc --noEmit`: no errors in either file. Project-wide `bun run lint` exits 0. Verified live: GET / 200; GET /api/progress 200 (real DTO shape); POST /api/bean/chat 200 ({reply, usedContext}).
- Note: during development the dev server intermittently 500'd due to a concurrent Task 4-b edit (lucide `BookOpenNote` import in topic-view.tsx); resolved by the 4-b agent — no files outside my two assigned views were touched.

Stage Summary:
- Task 5-a complete: BeanView + ProgressView fully implemented per VIEW CONTRACT (guest-scoped, api.* only, navigate-only routing, gold/black design tokens, mobile-first, max-h + overflow lists, honest empty/error states). No schema/API/lib/design-token changes.
