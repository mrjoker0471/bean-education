# BEAN Expert Onboarding & Verification — Operational Guide (CI-6E)

> Audience: BEAN administrators running real expert recruitment.
> Scope: how to invite, verify and activate genuine subject-matter experts with
> the CI-5/CI-6 governance system — and what the system deliberately does NOT do.
>
> Status convention that governs everything below: **an operational interface is
> not an operational network.** Until a real, independently verified human record
> exists, the verified-expert count is zero, every production domain pack stays
> `IN_REVIEW`, and every language capability stays `LIMITED`/unmeasured.

## 1. What recruitment looks like in BEAN

```
   invite (CI-6E)        apply + evidence (CI-6B)        verify (CI-6C)
  ┌──────────────┐     ┌─────────────────────────┐     ┌──────────────────────┐
  │ admin creates│ ──▶ │ applicant claims invite │ ──▶ │ admin examines       │
  │ single-use   │     │ + applies via account   │     │ documents / registry │
  │ link (shown  │     │ + uploads evidence into │     │ + records append-only│
  │ once)        │     │ the restricted store    │     │ verification records │
  └──────────────┘     └─────────────────────────┘     └──────────┬───────────┘
                                                                  │
        ┌─────────────────────────────────────────────────────────┘
        ▼
  qualification decision (CI-5B)      activation + scoped assignments (CI-5C/6F)
  APPROVED (scope + verification      ACTIVE reviewers receive exact-scope
  recorded by a DIFFERENT admin)  ──▶ assignments; their human decisions feed
                                      pack/language/benchmark ledgers (CI-6G)
```

Every arrow is a server-authorised, append-only audited event. Nothing in the
chain can be granted from the client side, and no step can be performed by the
same account that benefits from it (self-approval is structurally refused).

## 2. Inviting experts (no email is sent by BEAN)

BEAN deliberately has **no email/notification infrastructure** and does not
pretend otherwise. Recruitment is administrator-controlled:

1. Sign in as an administrator → `#/admin/ci5-reviewers` → **Verification** tab
   → *Expert invitations*.
2. Choose the requested category (`DOMAIN_EXPERT` or `BILINGUAL_LANGUAGE`),
   optionally the requested domains (advisory only), a validity window
   (1–90 days, default 14) and an optional note to the applicant.
3. **Copy the claim link immediately.** The raw token is shown exactly once and
   only its SHA-256 hash is stored — it cannot be recovered later. Share it
   through your own secure channel (direct message, in-person, video call).
   Never post invitation links publicly; never send unsolicited bulk mail.
4. Track status in the same panel: `pending → claimed / expired / revoked`.
   Revoke unused invitations (reason required, min 10 chars) when recruitment
   plans change.

Hard properties (enforced server-side): single-use claims (replay refused),
lazy expiry, revocation, strict per-account rate limiting on claim attempts,
and **claiming never grants any privilege** — it only links the invitation to
the applicant's account so the application can reference it as provenance.

## 3. What applicants do

1. Open the claim link → sign in with their **existing BEAN account** (never a
   duplicate identity) → *Claim invitation*.
2. Complete the three-step application at `#/expert-apply`: category and
   proposed domains/specialties, professional background and affiliation, an
   explicit conflict-of-interest declaration, a review-exact-information step
   and explicit consent to credential verification.
3. Upload credential evidence (PDF/PNG/JPEG, ≤10 MiB per file) into the
   restricted evidence store. Files are never public and never attached to
   ordinary profile endpoints.
4. Answer administrator information requests in place; withdraw (terminal)
   if they change their mind — evidence files are purged, metadata and hashes
   retained.

An application **never** auto-approves anything: pending applicants cannot
claim assignments, and no client-submitted field can flip
`verificationStatus`, `status` or scope (strict schemas refuse them).

## 4. Verifying credentials (the human core)

Sign in as an administrator (a **different** account than the applicant —
self-verification is refused with 403) → Verification tab → open the
application:

1. **Examine the evidence** through the restricted streaming view. Record what
   you actually examined. Possession of a document is never proof of its
   authenticity — say what you checked and what you found.
2. **Record a verification examination** (append-only). Choose the honest
   method:
   - `DOCUMENT_EXAMINATION` — requires ≥1 ACTIVE evidence document of this
     application;
   - `ISSUING_BODY_REFERENCE` — requires a recorded reference detail
     (whom you contacted, through what permitted channel, when);
   - `PUBLISHED_REGISTRY` — requires the registry entry reference.
   Every decision (VERIFIED / REJECTED / NEEDS_MORE_EVIDENCE / SUPERSEDED)
   needs a documented reason (≥20 chars). Corrections are NEW rows, never
   edits. No third-party verification result may be fabricated.
3. **Request more information** when evidence is insufficient — the applicant
   answers in place and the loop is audited.
4. Only after verification, make the **qualification decision** in the
   *Reviewers* tab (CI-5B): APPROVED requires a verification status, stated
   qualification facts and an explicit server-controlled scope (exact domains
   or exact language tag+task pairs — TRANSCRIPTION is structurally refused).
   Then ACTIVATE. Verification records never change status by themselves, and
   administrators can never substitute for the qualified-expert judgment that
   content approvals require (CI-4C/CI-5D/CI-5E gates remain authoritative).

## 5. After activation

- Active reviewers see their exact-scope assignments at `#/reviewer`
  (CI-5C/CI-6F). Scope mismatch, conflicts, recusal and reassignment are
  server-enforced.
- Their human decisions land in the append-only pack/language/benchmark
  ledgers with full provenance (real authenticated reviewer, exact scope,
  evidence, version, decision).
- The public expert directory (`#/experts`) shows a reviewer only after they
  explicitly consent to listing; the five capability states stay independent.

## 6. Honest reporting (what you may claim)

`GET /api/admin/ci6/reporting` (CI-6G) reports every real count from its own
ledger — applications, pending verifications, verified-eligible reviewers,
active assignments, completed human reviews, real expert labels, genuinely
approved packs, genuinely measured languages — **displaying zero where the
real count is zero**. Fixture/synthetic records are never counted as real
approvals. When reporting to stakeholders, distinguish:

- *software readiness* (this system, implemented and tested), from
- *real-world activation* (genuine experts recruited, verified, producing
  evidence) — report the actual verified count, even when it is zero.

## 7. Retention and privacy rules

- Evidence files live in the restricted store (`0600`), referenced by id and
  SHA-256; they are excluded from the learner data export and never served by
  public URLs. Withdrawal purges file bytes; metadata + hash remain for the
  audit trail. Purged documents cannot back new verification decisions (409).
- Reviewer ledgers are FK-less by design: audit history survives account
  deletion (proven by CI-5 reliability tests). Do not "clean up" audit rows.
- Verification reasons, COI declarations and admin events are internal — they
  never appear on public profiles.
- Tokens: raw invitation tokens are never logged or stored; if a token leaks,
  revoke it (if unclaimed) — claimed tokens are dead ends by construction.
