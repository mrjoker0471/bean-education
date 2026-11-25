# Authentication Age Clarity + Legal Consent Alignment — Results (2026-11-25)

Branch: `feat/bean-auth-age-legal-consent-ux` (from origin/main `9e932eee174aa0f2f4f44eecc1a6a74c93b54382`).
Scope: teacher signup age presentation + reusable legal-consent rows + honest version metadata. NO backend policy change.

## What changed

1. **Teacher signup presentation** (`src/components/bean/auth-view.tsx`)
   - REPLACED the two-option age declaration (radios "I am 18 or older" / "I am under 18" + safeguarding block) for the TEACHER audience ONLY, with ONE compact confirmation checkbox:
     "I confirm that I am 18 or older and eligible to create a BEAN Teacher account."
   - The checkbox must be explicitly selected (signup refuses otherwise, with input preserved); it maps onto the SAME server-validated contract (`ageDeclaration: 'ADULT_18_PLUS'`) — the value sent is the declaration the user actually made, never fabricated, and the server still sets `ageBand` itself.
   - Honest framing line: this is BEAN's account-eligibility requirement for every account, NOT a teaching qualification; teaching rights come only through the reviewed BEAN Teach application.
   - No date-of-birth field, no numeric age input, no under-18 option in the teacher presentation; the teacher professional profile (teach application schema) continues to collect no DOB.
   - **Student and Institution audiences keep the original two-option declaration and child-safeguarding explanation, unchanged.**
   - Switching audience resets the declaration (no cross-presentation carry-over).
   - Signup-only gating preserved (CI-3 regression): password sign-in and Google sign-in render and require NO declaration; the Google start button is never blocked by signup-only state; Google SIGN-UP keeps the full acceptance + declaration gates.
2. **Reusable consent component** (`src/components/bean/legal-consent-row.tsx`, new)
   - Two independent full-width rows on one shared surface with a subtle `divide-y` separator; equal padding; aligned starting positions.
   - CSS grid `grid-cols-[auto_minmax(0,1fr)]`: fixed checkbox column, flexible text column (`min-w-0`) — text and links wrap inside the column on mobile without shifting the checkbox; checkbox aligned to the first line of text; consistent 4×4 checkbox size.
   - Terms row: "I agree to the Terms & Conditions." + visible "Read the Terms & Conditions" link. Privacy row: "I acknowledge the Privacy Policy and understand how my information is used." + visible "Read the Privacy Policy" link. Links target the EXISTING routes (`#/terms`, `#/privacy`) in a new tab.
   - **Links are siblings of the `<Label>` — never nested inside it — so activating a link cannot toggle the checkbox or submit the form.**
   - Version metadata occupies its own muted line, derived from GET `/api/legal/config`: `Draft · Version <configured>` while the shipped versions are drafts; `Effective <date> · Version <configured>` ONLY when the owner configured an effective date; `Version <configured>` otherwise; and an honest "Version not published yet — the server confirms the current version when you create your account." when the config is unavailable. No hardcoded versions or dates; a draft is never shown as approved; no effective date is ever fabricated.
3. **Vertical rhythm**: audience selector → tabs → display name → email → password → eligibility confirmation → Terms/Privacy → Google, all at a consistent card width with restrained surfaces (two fieldset surfaces + one consent surface — no nested-card pileup).

## Backend — unchanged (verified, not weakened)

- `POST /api/auth/register` and `POST /api/auth/google/complete` keep `ageDeclaration: z.enum(['ADULT_18_PLUS','UNDER_18'])`, the server-side under-18 fail-safe (403 `guardian_verification_unavailable`, nothing stored), server-side CURRENT-version validation (`stale_legal_version`), server-set `ageBand: 'ADULT_18_PLUS'`, `REGISTRATION_ROLE = 'STUDENT'` and the role-refusal guard.
- `POST /api/auth/login` requires only email + password — no declaration, no legal validation.
- Consent version recording + stale-version invalidation untouched.

## Tests

`tests/unit/auth-age-eligibility-consent.test.ts` — 28 tests (route-level via the repo's auth-mock pattern + source-level regression guards):

- Teacher registration WITH the explicit declaration → 200, `signupIntent: TEACHER`, role STUDENT, server-set `ageBand: 'ADULT_18_PLUS'`, versioned TERMS+PRIVACY acceptances recorded.
- Teacher registration WITHOUT the declaration → 400, nothing stored (cannot silently bypass).
- Teacher-intent `UNDER_18` → 403 fail-safe (backend under-18 guard is audience-independent).
- Student `UNDER_18` → 403; student without declaration → 400 (student safeguards intact).
- Institution explicit declaration → 200 `signupIntent: INSTITUTION`; institution `UNDER_18` → 403.
- Stale Terms version → 400 `stale_legal_version`; client-set role → 400 (regressions).
- Google signup: teacher + explicit declaration → 200; `UNDER_18` → 403; missing declaration → 400; identity linked; server-set age band.
- Source guards: exact teacher confirmation sentence rendered; teacher fieldset contains no `bean-age` radios / under-18 option / DOB / numeric age; signup collects no DOB anywhere; teach schema still documents and enforces no-DOB; the two-option student/institution declaration is preserved; audience switch resets the declaration; `<LegalAcceptanceFields>` renders only under `panel === 'signup'` (2 occurrences: password signup + Google signup); sign-in branch contains no declaration/legal gating; login API has no age/legal validation; `startGoogle` depends on nothing but `googleConfigured`/`busy`; consent rows use the fixed/flexible grid with sibling links (label contains no `href`), `target="_blank" rel="noreferrer"`, metadata derived from config (no hardcoded versions), and the register schema still owns the declaration vocabulary.

## Full verification stack (local, isolated DATABASE_URL)

- `bun test --isolate`: **1549 pass / 0 fail** (1521 on main + 28 new), 107 files.
- `bun run lint` clean; `bun x tsc --noEmit` clean.
- `prisma validate` clean; `prisma migrate deploy` applied ALL migrations on a fresh database.
- `bun run build` (production) exit 0.

## Browser verification (real dev server, real registration)

Golden path at `#/auth`:

- Teacher audience → signup panel renders the single eligibility confirmation (no radios).
- Submitting with everything EXCEPT the confirmation → explicit error "Please confirm that you are 18 or older and eligible to create a BEAN Teacher account.", **all user input preserved** (verified: email value still present, checkboxes still ticked).
- Checking the confirmation → real registration succeeded: navigated to `#/onboarding`; server record verified directly in the database: `signupIntent: 'TEACHER'`, `ageBand: 'ADULT_18_PLUS'`, `role: 'STUDENT'`, acceptances `TERMS:2026-11-23-draft.1` + `PRIVACY:2026-11-23-draft.1`.
- Password SIGN-IN panel renders ONLY email + password (no declarations) and a real sign-in with the created account succeeded (POST `/api/auth/login` 200 → `#/onboarding`).
- Student audience → the two-option declaration with the safeguarding explanation is intact (2 radios).
- Clicking "Read the Terms & Conditions" opens a NEW tab at the existing `#/terms` route; the original form's checkbox states and inputs are untouched (verified after returning to the tab).
- Horizontal overflow: NONE at 1440 / 768 / 390 / 320 (`document.scrollWidth === innerWidth` at every width). (One transient 94px header-nav overflow was observed only in a stale in-memory SPA state mid-walkthrough; a clean reload measured CLEAN and it is untouched by this diff — the header file has no changes on this branch.)

Screenshots (`docs/screenshots/auth-consent/`): `1440-teacher-signup.png`, `1440-teacher-signup-full.png` (full page incl. both consent rows + metadata), `768-teacher-signup.png`, `390-teacher-signup.png`, `320-teacher-signup.png`, `320-teacher-signup-full.png` (mobile wrapping: text wraps inside the flexible column, checkbox never shifts), `1440-student-signup.png` (student declaration preserved alongside the new consent rows).

## Honest status labels

- IMPLEMENTED + TESTED + HUMAN-VERIFIED (browser walkthrough): teacher eligibility confirmation, consent rows, version metadata, signup-only gating, student/institution preservation, link isolation, responsive wrapping, golden-path registration + sign-in.
- UNVERIFIED IN BROWSER: Google OAuth round-trip (no OAuth credentials in the sandbox — the button is honestly disabled); covered by route tests instead.
- UNSUPPORTED (unchanged policy): under-18 personal-data accounts (guardian verification not available); no DOB collection anywhere in signup or the teacher profile.
