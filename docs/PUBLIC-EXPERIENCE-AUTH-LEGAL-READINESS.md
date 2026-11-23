# Public Experience, Authentication & Legal Foundation — Implementation Readiness

**Milestone ID:** `public-experience-auth-legal`
**Branch:** `feat/bean-public-experience-auth-legal`
**Base main SHA:** `65d51c2b003eda92f2443ce187761e0eddf16238`
**Owner-approved scope:** Homepage improvement, Student/Teacher entry flow, password and Google authentication, Terms and Conditions, Privacy Policy, legal acceptance, privacy rights and complete account-deletion review.
**Companion legal analysis:** `docs/INDIA-DATA-PRIVACY-AND-PLATFORM-LEGAL-READINESS.md`

> Google sign-in is **credential-dependent**: the real integration and configuration
> support are implemented and unit/browser-verified, but a live external Google
> login cannot be verified until the owner supplies `GOOGLE_CLIENT_ID` /
> `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`. It is reported as such — never
> claimed as live-verified.

---

## 1. Changed files

**New (server)**
- `src/lib/oauth-google.ts` — real authorization-code flow: PKCE S256, state/nonce, RS256 ID-token verification against Google's published JWKS, issuer/audience/expiry/`email_verified` validation, strict redirect-URI validation (https outside loopback), no token storage.
- `src/lib/legal-config.ts` — server-side current Terms/Privacy versions + operator/grievance configuration (env-driven, nothing invented).
- `src/lib/legal-acceptance.ts` — per-student acceptance status vs. current versions (re-acceptance computation).
- `src/lib/rate-limit.ts` — in-memory sliding-window limiter for authentication/OAuth/grievances/sensitive actions.
- `src/lib/teacher-intent.ts` — pure post-auth routing matrix + client resolution (audience intent is navigation only).
- `src/app/api/auth/google/{status,start,callback,link,complete}/route.ts` — configuration-status probe, OAuth start, callback state machine (sign-in / direct-link / password-proof link / pending signup), proof-of-ownership linking, acceptance-gated Google signup.
- `src/app/api/legal/config/route.ts` — public secret-free legal configuration.
- `src/app/api/legal/accept/route.ts` — server-validated re-acceptance recording.
- `src/app/api/privacy-request/route.ts` — owner-scoped, confidential grievance/privacy requests (DPDP §13 readiness).
- `scripts/legal-release-check.mjs` — production legal-publication release check (warn-only by default; `--strict` blocks).

**New (client)**
- `src/components/bean/policy-page.tsx` — shared policy shell: section navigation, version display, draft badge, configuration-aware operator/grievance block.
- `src/components/bean/views/terms-view.tsx` — Terms and Conditions (22 sections).
- `src/components/bean/views/privacy-view.tsx` — Privacy Policy (10 sections, audit-based).
- `src/components/bean/views/legal-acceptance-view.tsx` — re-acceptance screen preserving logout/export/deletion/grievance access.

**Modified (client)**
- `src/components/bean/views/home-view.tsx` — full homepage: hero ("Learn. Practise. Teach. Grow. All in one place."), student/teacher split, 11 real feature cards in 3 groups with sign-in/approval badges, BEAN method, trust strip, closing CTA; backend count pills retained.
- `src/components/bean/auth-view.tsx` — audience-first flow ("How would you like to use BEAN?"), sign-in/create/Google, change-audience without losing input, legal acceptance + age declaration, Google pending link/signup panels.
- `src/components/bean/views/settings-view.tsx` — deletion workflow (preview → typed DELETE → password re-auth), legal page links, privacy-request form with categories.
- `src/components/bean/views/onboarding-view.tsx` — teacher-intent handoff to the application after onboarding.
- `src/components/bean/footer.tsx` — Terms/Privacy links, consistent `navigate` usage, BEAN EDUCATION wordmark.
- `src/app/page.tsx` — terms/privacy routes, re-acceptance gate (allowed views preserved), async post-auth routing via the real application status.
- `src/lib/store.ts` — `terms`/`privacy` routes (parse + serialize), `legalStatus` state.
- `src/lib/api.ts`, `src/lib/types.ts` — new endpoints/DTOs (LegalConfigDTO, LegalStatusDTO, signupIntent).

**Modified (server)**
- `src/app/api/auth/register/route.ts` — server-validated Terms/Privacy versions, age declaration with under-18 fail-safe (403, nothing stored), intent recording, rate limiting; role-refusal preserved.
- `src/app/api/auth/login/route.ts` — rate limiting.
- `src/app/api/auth/me/route.ts` — returns server-computed `legal` status.
- `src/lib/auth.ts` — `AuthStudent.signupIntent` (navigation intent only).
- `src/app/api/auth/account/delete/route.ts` — GET deletion preview (live category counts + `requiresPassword`); POST adds password re-authentication, explicit `ResearchSession`/`ResearchPyqCandidate`/`OAuthIdentity` cleanup, honest retention note in the result.
- `src/app/api/auth/account/export/route.ts` — `bean-export-v2`: research sessions/candidates, teacher profile + classes taught, bookings, reviews, complaints, appeals, institution memberships, career profile/skills/projects/credentials/applications, legal acceptance history, consent records, OAuth identities (metadata only; still no password hash).
- `src/app/api/account/route.ts` — guest purge now includes research sessions/candidates.

**Schema & infrastructure**
- `prisma/schema.prisma` — `Student.passwordHash` nullable (Google-only accounts), `Student.signupIntent`, `Student.ageBand`; new models `OAuthIdentity` (provider+subject unique), `OAuthPendingAuth` (10-minute server-side bridge), `LegalAcceptance`, `ConsentRecord`, `PrivacyRequest`.
- `prisma/migrations/20261123033755_public_exp_auth_legal/` — additive migration (new tables + Student rebuild for the nullable hash).
- `.env.example` — Google OAuth placeholders + legal operator/grievance/version fields (all empty; no credentials ever committed).

**Tests**
- New: `tests/unit/public-exp-routing.test.ts` (legal routes + every feature-card destination + routing matrix), `tests/unit/oauth-google.test.ts` (real RSA-signed JWT verification chain, PKCE, redirect validation), `tests/unit/oauth-routes.test.ts` (status/start/callback/link/complete state machine), `tests/unit/legal-acceptance.test.ts` (stale versions, under-18 fail-safe, role refusal, acceptance recording), `tests/unit/account-deletion-export.test.ts` (reauth, FK-less-table cleanup, export v2 coverage contract), `tests/unit/privacy-request-route.test.ts` (owner scoping, rate limit).
- Updated mocks only (no assertion weakened): `learning-compat.test.ts` and `riishe-phase3d-chat-preferences.test.ts` gained empty stubs for the newly exported domains; `free-pilot-protection.test.ts`'s complaint-endpoint scan now strips comments (consistent with its other scans) and recognises `auth/account/` routes as requireStudent-guarded, owner-scoped paths.

**Documentation**
- `docs/INDIA-DATA-PRIVACY-AND-PLATFORM-LEGAL-READINESS.md`, this document, `docs/DEVELOPMENT_ROADMAP.md`, `docs/milestone-ledger.json`, `docs/MILESTONE-LEDGER.md`.

## 2. Database / migration impact

- Additive migration `20261123033755_public_exp_auth_legal` verified with `prisma migrate deploy` on an isolated database (`file:/tmp/bean-verify.db`, all 13 migrations applied) and with `prisma generate`.
- Existing password accounts are unaffected: `passwordHash` values survive the Student table rebuild; password login/scrypt verification unchanged.
- Existing guest-claim/delete/export flows extended, never replaced.

## 3. Authentication design

- **Custom BEAN session architecture preserved** — `bean_session` httpOnly cookie, scrypt password hashing, hashed session tokens, same-origin guards. No competing session system; `next-auth` remains unused.
- **Audience-first flow:** the first auth step asks "How would you like to use BEAN?" (Student/Teacher). The choice is an onboarding/navigation intent recorded as `Student.signupIntent` — it can NEVER grant authorization. Roles remain `STUDENT | PYQ_CURATOR | ADMIN`; registration hardcodes `STUDENT`; the role-refusal defense (400 on a client-supplied `role`) is intact and tested.
- **Teacher routing:** intent → onboarding first (new registrations) → the existing teacher application lifecycle (form/pending/rejected-resubmission/approved dashboard), resolved against the server-side application status. Existing student accounts can apply without a second account.
- **Student routing:** onboarding → dashboard; guest mode and guest-data claiming preserved (`claim-guest` unchanged).
- **Google OAuth (server-side, custom-session integrated):**
  - Start: rate-limited; without credentials → truthful 503 `google_not_configured` (UI disables the button with an honest message; `/api/auth/google/status` powers it).
  - Callback: state cookie↔query timing-safe match, code+PKCE-verifier exchange, ID-token verification (RS256 via JWKS, issuer allow-list, audience/azp, expiry/iat skew, nonce, `email_verified === true`), then: known subject → session; email match + password-less account → direct link; email match + password → 10-minute server-side pending LINK + client password proof; no account → pending SIGNUP + the same legal acceptance as password signup.
  - One Google subject ↔ one BEAN account (`OAuthIdentity` unique); duplicate subject → 409; OAuth never assigns a role.
  - No Google access/refresh tokens stored; cookies are httpOnly/SameSite=Lax/secure-in-prod; all outcomes redirect to `#/auth` with explicit markers — no dead ends.

## 4. Legal policy versions

- Current server-validated versions (defaults, owner-overridable via env): `BEAN_TERMS_VERSION=2026-11-23-draft.1`, `BEAN_PRIVACY_VERSION=2026-11-23-draft.1` — the `draft` suffix renders a visible draft badge; both pages are public (no sign-in) at `#/terms` and `#/privacy`, linked from the footer, registration and Settings.
- Signup and Google-complete validate the CURRENT versions server-side (stale → 400 `stale_legal_version`); re-acceptance screen appears when `/api/auth/me` reports `reacceptanceRequired` — acceptance is never implied by sign-in, and logout/export/deletion/privacy-request paths stay reachable during the gate.
- Purpose-specific consent infrastructure is live; BEAN currently offers NO optional purposes (nothing preselected, nothing bundled).

## 5. Actual provider inventory (audited)

| Processor | Receives | When |
| --- | --- | --- |
| Platform AI provider (Riishe/BEAN chat) | Question text + conversation/document context needed to answer | AI features used |
| LiveKit | Classroom audio/video media | Only when the owner configures it; honest "not configured" otherwise |
| Google | OAuth identity only (sub, verified email, profile name; scopes `openid email profile`) | Only when configured |
| Operator hosting/database | Application data | Always (details operator-managed — public policy does not invent them) |

No email provider, no analytics, no advertising/tracking SDKs exist in the codebase. Whether the AI provider trains on submitted content is NOT claimed either way — documented as owner-TO-VERIFY.

## 6. Legal details still required from the owner

See `docs/INDIA-DATA-PRIVACY-AND-PLATFORM-LEGAL-READINESS.md` §F checklist (operator identity, grievance officer, support contacts, policy versions after counsel review, Google credentials, processor agreements, amended-rules deadlines). `scripts/legal-release-check.mjs` lists the missing items and `--strict` blocks a legal-publication release; ordinary CI is unaffected.

## 7. Child-safeguarding implementation status

- Implemented: age self-declaration (18+ / under-18), under-18 personal-data account refusal (fail-safe, nothing stored), no DOB/Aadhaar/ID collection, no ads or behavioural tracking anywhere, guest mode cannot bypass the gate, Phase 6/7 safeguarding preserved.
- Designed but not operational: verifiable-parental-consent workflow (required before the DPDP child-consent commencement; never a checkbox/email-OTP labelled as verification).

## 8. Applicable-law assessment & unresolved questions

Documented in `docs/INDIA-DATA-PRIVACY-AND-PLATFORM-LEGAL-READINESS.md` (DPDP Act/Rules, IT Intermediary Rules amended Feb 2026, E-Commerce Rules 2026 amendment scheduled 1 Jan 2027). Unresolved: exact grievance deadlines from the Feb 2026 amendment text, hosting/backup retention windows, e-commerce applicability conclusion — all marked TO VERIFY for counsel; nothing invented.

## 9. Test and browser evidence

**Documented checks (2026-11-23, this branch):**
- `bunx prisma validate` — valid schema; `prisma migrate deploy` on isolated DB — all 13 migrations applied.
- `bunx prisma generate` — client 6.19.2 with new models.
- `bun run lint` — 0 errors, 0 warnings.
- `bun x tsc --noEmit` — clean.
- `bun test` — **1241 tests pass, 0 fail** across 84 files (was 1236 pass/4 fail before the mock-compat updates; the 4 updated tests are the export/delete/static-scan suites described in §1).
- `bun run build` (production) — success; all 8 new API routes present in the manifest.

**Browser verification (agent-browser, screenshots in `docs/screenshots/public-exp/`):**
- **390px:** hero + CTAs, audience-first auth, signup with age declaration + legal checkboxes (versions shown, draft badge), Google button disabled with honest message, under-18 refusal notice, Terms (22 sections) and Privacy pages with section navigation, settings privacy-request form; screenshots `390-home.png`, `390-auth-audience.png`, `390-terms.png`, `390-privacy.png`, `390-delete-preview.png`.
- **768px:** full-page home (`768-home-full.png`) — audience split and 3-column feature grid collapse correctly.
- **1280px:** desktop hero/nav/features (`1280-home.png`); no console errors on load.
- **Interactions verified live:** feature-card navigation to `#/catalog`, `#/dashboard`, `#/teach/dashboard`, `#/bean`; adult registration end-to-end; teacher-intent registration → onboarding → `#/teach/apply` handoff; audience change preserves entered email/password; deletion dialog preview → typed-DELETE + password re-auth step with disabled submit; privacy-request submission (201); footer pushes down naturally on long pages (no overlap, no floating gap).
- Live Google login: **credential-dependent, not verified** (no credentials available).

## 10. Honest limitations

- Rate limiting is single-process memory (resets on restart) — same model as the existing learning scopes; a durable limiter is future work when multi-instance deployment arrives.
- The re-acceptance gate is client-rendered (server endpoints validate versions on every protected action regardless).
- OAuth state/PKCE cookies are SameSite=Lax (standard for redirect flows) with 10-minute expiry.
