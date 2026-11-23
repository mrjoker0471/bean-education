# BEAN Education — Premium Brand & UI Redesign (2026-11-23)

Milestone: `bean-premium-brand-ui-redesign` · Branch: `feat/bean-premium-brand-ui-redesign` ·
PR: [#28](https://github.com/mrjoker0471/bean-education/pull/28) (MERGED, `c585db4`)

## 1. Mandate

Redesign BEAN's interface into a premium, distinctive, professional glassmorphic
education platform; rename the public-facing brand to **BEAN Education**;
review the supplied content (Trust & Safety, Terms, Privacy) against the real
backend; preserve every existing feature, route, API and legal safeguard.

## 2. Starting state (verified, not assumed)

- `git ls-remote` + `git fetch` verified the live remote before any work.
- **PR #27 had already merged `feat/bean-public-experience-auth-legal`** into
  main: all five experience commits (`c2b5e7a`, `6a1c1d2`, `dac46e5`, `b0cda7d`,
  `a0fb5b6`) verified as ancestors of `origin/main` = `fcf7418`
  (`rev-list --left-right --count` = `1 0`).
- The redesign branch was therefore cut from **`origin/main` (`fcf7418`)**,
  which preserves the full experience work — not from an outdated ref.

## 3. Design system

Brand palette (from the written brand direction — see blockers for the note
about the logo attachment): deep obsidian black, metallic gold, champagne
gold, warm ivory.

| Token | Value | Role |
|---|---|---|
| `--page` / `--background` | `#0A0A0C` | deep obsidian stage |
| `--card` / `--elevated` | `#131210` / `#1A1814` | warm obsidian surfaces |
| `--foreground` / `--ivory` | `#F2EDE2` | warm ivory reading colour |
| `--gold` / `--primary` | `#C6A05E` | restrained metallic gold |
| `--gold-hover` | `#D9BC85` | champagne hover |
| `--champagne` | `#E9DCBD` | pale champagne highlights |
| `--hairline` | `rgba(233,220,189,0.10)` | champagne hairline borders |

New glass utilities (`glass`, `glass-soft`, `glass-deep`, `obsidian-ambient`):
controlled blur (10–22px), inset champagne sheen, hairline borders — no neon,
no glow stacking, no decorative clutter. All pre-existing token/utility names
(`bg-page`, `text-gold`, `bg-elevated`, …) keep their meanings so the 100+
existing components restyle coherently without breaking anything.

Brand mark: a gold bean on an obsidian tile, rendered through one component
(`src/components/bean/brand-mark.tsx`) plus the swappable public asset
`public/logo.svg` (app icon + metadata point there) — replacing the old
generic "Z" glyph. The wordmark renders as **BEAN Education** (sans-serif
"BEAN", Playfair italic champagne "Education"). No "BEAN EXAMS" wordmark was
recreated; the assets are single-file so the final logo can be dropped in.

## 4. Public-facing rename

Every public-facing "BEAN EXAMS"/"BEAN LEARN" string became **BEAN
Education**: metadata title/keywords/authors, loading + not-found states,
catalogue/registry/syllabus strings, "Written by BEAN Education", AI persona
prompts (Riishe, BEAN Intelligence), the PDF reader UA, onboarding screens and
the header wordmark (was "BEAN LEARN"). Pure code comments in data files were
left as-is except where they are content.

## 5. Content audit — Trust & Safety, Terms, Privacy

Every Trust & Safety claim was verified against the enforced backend
(schema, `src/lib/trust*.ts`, teach/trust/admin API routes, test suites).
Four corrections + new honest disclosures (no invented safeguards):

1. **Reviews**: attendance is confirmed by the teacher; live-classroom
   attendance evidence is *advisory context* for teachers — the server
   enforces the teacher's ATTENDED marking, not raw classroom data. (The old
   "server cross-checks live attendance evidence" overclaim was also corrected
   in the class review section.)
2. **Moderation**: "criticism is never a violation on its own" restated as
   BEAN's moderation *policy*, not a technical guarantee.
3. **Appeals**: scoped to adverse decisions — decided complaints, hidden
   reviews, trust restrictions; overturns are documented restorations.
4. **Teacher replies**: no creation deadline; the 7-day window applies to
   editing a posted reply.

Added real, previously unstated safeguards: flagged reviews excluded from
averages during moderation; 3-review minimum before numeric averages
("New teacher"); class-less sensitive reporting; server-derived HIGH severity
for safeguarding/harassment/discrimination; admin notes redacted from
complainants; complaint assignment/escalation/info requests; server-side teeth
of trust restrictions (pause listings / suspend publishing / emergency stop);
anti-spam rate limits.

**Terms & Privacy**: verified factually consistent with the audited backend
(no payment/payout/refund paths, attendance/review/appellate rules, session
and deletion semantics). No legal meaning changed; draft/legal-review notices
preserved verbatim. Visual polish only (glass sections, scroll-spy nav,
version/draft badges).

## 6. Files changed

- Design system: `src/app/globals.css`, `src/components/bean/brand-mark.tsx` (new), `public/logo.svg`
- Shell: `src/app/layout.tsx` (metadata/icons), `src/app/page.tsx` (loading, not-found, AuthStage)
- Chrome: `src/components/bean/header.tsx`, `src/components/bean/footer.tsx`
- Surfaces: `views/home-view.tsx`, `auth-view.tsx`, `views/trust-policy-view.tsx`,
  `trust/review-section.tsx`, `policy-page.tsx`, `views/legal-acceptance-view.tsx`
- Rename strings: `exam-parts.tsx`, `pdf-viewer.tsx`, `views/exam-view.tsx`,
  `views/topic-view.tsx`, `views/result-view.tsx`, `views/riishe-view.tsx`,
  `views/onboarding-view.tsx`, `api/pdf/route.ts`, AI persona strings in
  `lib/riishe/*`, `api/riishe/chat`, `api/bean/chat`
- CI: `.github/workflows/ci.yml` (Tests step → `bun test --isolate`; see §8)
- Screenshots: `docs/screenshots/brand-redesign/` (1440/768/390)

## 7. Verification (all green before the PR)

- `bun run lint` — clean
- `bunx tsc --noEmit` — clean
- `bun test` — **1241 pass / 0 fail** (also verified against a fresh,
  unseeded database with no `.env`, replicating the CI condition exactly)
- `bun run build` — production build OK
- Browser (headless Chromium against a local dev server):
  - 1440×900: home, auth stage, Trust & Safety, Terms, Privacy
  - 768×1024 and 390×844: home (incl. full-page), auth
  - Functional: mobile menu opens with all items; auth flow
    audience → Student → sign-in/sign-up with server-supplied legal versions;
    zero console/page errors (only a pre-existing Radix DialogContent warning)

## 8. CI incident, root cause and fix

Two push runs failed the Tests step in CI (`45115421072` on `973a6bcc`,
`45115982716` on `f8633f3`) with `oauth-google.test.ts` receiving the
`oauth-routes.test.ts` mock `verifyGoogleIdToken` (sub `google-sub-1`).
Root cause: bun can execute test files concurrently against **one shared
module registry**, so `mock.module()` in one file leaks into another file's
imports while both are in flight — scheduling-dependent (main's identical
files passed the same CI twice), i.e. a pre-existing flaky pattern, not a
content regression. The branch did not touch the OAuth path at all.
Fix: CI's Tests step now runs `bun test --isolate` (fresh global object per
file, order-independent). Both runs on the merged tip `38a5f62` are green:
`45116678858` (push) and `45116949273` (PR #28 pull_request) — 1241/1241.

## 9. Git trail (all pushes verified via `git ls-remote`)

| Commit | Subject |
|---|---|
| `d74b693` | feat(brand): BEAN Education identity — tokens, glass, brand mark, header/footer, rename |
| `eee5ee6` | feat(home): premium homepage on the design system |
| `8c9c607` | feat(auth): art-directed authentication stage |
| `c895f82` | feat(trust): Trust & Safety redesign + factual alignment |
| `973a6bc` | style(legal): Terms & Privacy on the design system |
| `f8633f3` | fix(header): one-line primary nav + verified screenshots |
| `38a5f62` | fix(ci): `bun test --isolate` to stop cross-file mock leakage |

Base main `fcf7418` → merge `c585db4` (PR #28, opened and merged by the owner
session per ADR-008 after CI verification). The feature branch was
fast-forwarded to `c585db4` with `--ff-only` and re-verified via
`git ls-remote` — zero drift; no force-push, no history rewrite, no branch
deletion anywhere in this milestone.

## 10. Blockers and gaps (honest)

1. **The attached BEAN logo was not delivered into this environment** — no
   uploaded file exists in the sandbox. The design system was therefore built
   from the explicitly written brand direction in the task (obsidian black,
   metallic gold, champagne gold, warm ivory; no neon; no blue/purple), and
   the new `public/logo.svg` is a neutral BEAN Education bean mark, **not** a
   recreation of the temporary "BEAN EXAMS" wordmark. Swapping in the final
   logo requires replacing exactly one file (`public/logo.svg`) and, if
   desired, one component (`src/components/bean/brand-mark.tsx`).
2. **The referenced attached documents / Trust & Safety text file were also
   not present**; the audit used the repo's shipped Trust & Safety, Terms and
   Privacy content and verified it against the real backend instead.
3. **PR creation/merge requires the owner's GitHub session** (ADR-008):
   the sandbox holds SSH deploy-key access only. The owner opened PR #28 and
   merged it after CI verification — consistent with all prior milestones.
