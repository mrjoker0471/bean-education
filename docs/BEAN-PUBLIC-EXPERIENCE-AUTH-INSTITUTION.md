# BEAN Public Experience — Authentication & Institution Access

**Milestone:** `bean-public-experience-auth-institution`
**Branch:** `feat/bean-auth-institution-ux`
**Status:** verification report for the institution-audience milestone (auth UX closure)

---

## 1. What ships

### 1.1 Institution as the third signup audience (merged via PR #37, commit `62abe14`)

- Shared `SIGNUP_INTENTS` vocabulary (`STUDENT | TEACHER | INSTITUTION`) in
  `src/lib/teacher-intent.ts`, wired through the password-registration Zod
  schema, the Google-completion Zod schema and the client types — the client
  and the server cannot drift.
- The audience choice is a **navigation intent only**. Every registration
  creates a STUDENT account; server-controlled roles are never client-settable;
  the intent never touches authorization, membership rows or teacher state.
- `postAuthDestination` / `resolvePostAuthRoute` / `postOnboardingDestination`
  form a single routing resolver:
  - Student → onboarding → `#/dashboard`
  - Teacher → onboarding → `#/teach/apply` (the application lifecycle:
    no application → form, PENDING → status, REJECTED → resubmission,
    APPROVED → `#/teach/dashboard`)
  - Institution → onboarding → `#/institution` (the real organization hub)
- Google round-trip: the audience chosen before the OAuth redirect is restored
  after the callback (`google_done` re-reads the pre-redirect choice and passes
  it to `onAuthed`); the account's persisted `signupIntent` is never overwritten
  by a later visit's chip selection.
- Three-audience panel with the milestone's exact copy and red-line honesty
  note ("Choosing "Teacher" does not grant teaching rights… Choosing
  "Institution" does not verify or approve an organisation — registration,
  verification and membership are separate administrator-controlled steps.").
- Honest age declaration: the user's actual declaration is sent to the server;
  the under-18 server guard is untouched and tested for **every** intent.
- Teacher application/profile schema contains **no** DOB, age, bank or
  government-identity fields (unknown fields are stripped server-side); the
  shared account-level 18+ declaration is unchanged and still required.
- 18 tests (`tests/unit/institution-audience.test.ts`): intent vocabulary,
  privilege separation (including no membership rows for any intent),
  under-18 guard per intent, Google INSTITUTION persistence, the routing
  matrix, and the teacher-schema cleanup.

### 1.2 This closure unit (this branch)

- `dc3fd5c` — autofill consistency on the dark glass inputs (Chromium/Safari
  opaque-background override, ivory caret/text) + per-audience chip wording
  (student/teacher/institution). **This commit had not reached `main`** — PR #37
  merged only `62abe14`; the branch was re-synced with `origin/main d64df69`
  (merge `45f5ee0`) per branch-hygiene rule 4 and ships here.
- `7c705c2` — fleet registry `register()` accepts Zod's INPUT type so
  schema-defaulted fields are optional. This clears 19 **pre-existing**
  `tsc TS2345` errors that make CI's `bun x tsc --noEmit` step fail on current
  `main`. The identical fix ships on
  `feat/bean-classroom-intelligence-agent-fleet` (CI-3C); whichever PR merges
  first wins, the other dedupes cleanly on re-sync.
- Onboarding skip honesty fix: "Skip everything and go to my dashboard"
  hard-coded `dashboard` and bypassed the intent resolver. Skipping now uses
  the SAME `postOnboardingDestination` resolver as finishing (teacher →
  application, institution → hub, student → dashboard) with a neutral honest
  label ("Skip setup and continue").
- Header responsive fix: the desktop primary nav became visible at `lg`
  (1024px) where brand + nav + account button measurably overflow the viewport
  (**143px** of horizontal scroll measured at 1024×768). The nav now appears
  from `xl` (1280px); tablet widths use the sheet menu. Verified: horizontal
  overflow **0px** at 1440 / 1280 / 1024 / 768 / 390 / 320.
- Browser verification evidence: `docs/screenshots/auth/` (9 screenshots:
  audience panel at 1440/1024/768/390/320, institution hub at 1440/390,
  teacher application at 1440/390).

## 2. Browser verification (real Chrome, dev server on the branch tip)

Golden paths exercised end-to-end:

| Flow | Result |
|---|---|
| Student: register → onboarding (5 steps) | landed `#/dashboard` |
| Institution: register → onboarding | landed `#/institution` — hub lists the two genuine actions (Register organization / Join with invitation), honest empty state, no approval promises |
| Teacher: register → skip setup | landed `#/teach/apply` (application form) |
| Teacher application form | no DOB / bank / government-ID fields; explicit notice "BEAN Teach never asks for date of birth, bank details or government identity documents"; qualification fields preserved |
| Validation errors | native email/password validation; near-field alerts; entered values retained |
| Audience chips | exact per-audience copy incl. "One BEAN account for your organisation… Verification and member permissions are separate, administrator-controlled steps." |
| Horizontal overflow | 0px at 1440/1280/1024/768/390/320 (after the header fix; 143px at 1024 before) |
| Sticky footer | footer sits at the viewport bottom on short pages (institution hub), pushed naturally on long pages |

## 3. Verification status

| Check | Result |
|---|---|
| `bun test` (full suite) | **1396 pass / 0 fail** (96 files; includes the 18 institution-audience tests) |
| `bun run lint` (ESLint) | clean |
| `bun x tsc --noEmit` | clean (also clears the 19 pre-existing main errors) |
| Prisma schema/migrations | no schema change in this unit (fleet task model lives on the CI-3C branch) |
| Production build | verified by CI on every PR (`ci.yml` quality job: lint → tsc → tests → `bun run build`); the sandbox cannot run `next build` locally |
| Remote push | every commit pushed and verified via `git ls-remote` (see milestone ledger) |

## 4. Honest limitations

- Google OAuth round-trip was verified at the unit/test level and by code
  inspection of the callback path; a live Google redirect could not be
  exercised in the sandbox (no OAuth credentials configured here). The
  OAuth implementation itself (PKCE S256, state, nonce, JWKS) is unchanged
  by this milestone and was verified in the earlier public-experience
  milestone.
- The institution hub's organization-registration and invitation workflows
  are the existing Phase-7 flows; this milestone verified the routing into
  them and their honest copy, not their full administrator lifecycle.
- PR creation remains an owner manual action (no authorised PR-creation
  credential in the sandbox), per `docs/GIT-BRANCH-HYGIENE.md` step 11.
