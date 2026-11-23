# India Data-Privacy and Platform Legal Readiness — BEAN Education

**Milestone:** public-experience-auth-legal (Public Experience, Authentication & Legal Foundation)
**Status:** legal-readiness implementation — **not a legal opinion**
**Reviewed against sources as of:** 23 November 2026
**Required before public launch:** Indian legal review by qualified counsel

> **Honesty rule enforced throughout this document:** where a date, deadline or
> applicability conclusion cannot be verified from the official text in this
> repository's environment, it is recorded as **TO VERIFY** rather than
> invented. Nothing in BEAN's public pages claims government approval,
> certification or guaranteed compliance.

---

## A. Digital Personal Data Protection Act, 2023 (DPDP Act)

### What the Act requires (reviewed sections)

| Provision | Requirement relevant to BEAN | BEAN status |
| --- | --- | --- |
| §4–5 | Lawful processing only for specified purposes; free, specific, informed, unconditional and unambiguous consent; clear notice | Implemented: versioned Terms + Privacy Notice at signup; server-validated versions; no bundled consent. See `src/lib/legal-config.ts`, `docs/milestone-ledger.json` (legal acceptance models). |
| §6 | Withdrawal of consent must be as easy as giving it; withdrawal consequences explained | ConsentRecord model supports per-purpose grant/withdraw; Settings exposes the privacy-request channel. Optional purposes currently offered: **none** (no marketing/tracking), so no optional consent is solicited at all. |
| §7 | Certain legitimate uses (voluntary provision, state functions, emergencies, employment) | Not relied upon for account creation — BEAN uses explicit consent + necessary-service processing. |
| §8 | Data-fiduciary duties: accuracy, security safeguards (Section 8(5)), retention/erasure, grievance redressal (8(7)), published contact of a data-protection contact person (8(9)) | scrypt password hashing, hashed session tokens, same-origin guards, server-side ownership checks, rate limits. **TO VERIFY/PUBLISH:** security-safeguard disclosures must match the real operator deployment (hosting, backups) before launch — the public policy deliberately does not invent hosting facts. |
| §9 | Children: verifiable parental consent for under-18s; no tracking/behavioural monitoring or targeted advertising directed at children; guardian-defined processing restrictions | **Fail-safe implemented:** under-18 personal-data accounts are refused until verifiable parental consent exists; no DOB collected; no ads/behavioural tracking exists on the platform at all. Guest mode does not bypass the gate — it stores no personal-data account. |
| §11–12 | Right to access information, correction, completion, updating, erasure | Implemented: JSON export (v2) covering all owned domains; correction via profile/application editing; deletion workflow with typed confirmation + re-authentication. |
| §13 | Right to grievance redressal | Implemented: `POST /api/privacy-request` (owner-scoped, confidential, rate-limited) with categories ACCESS/CORRECTION/ERASURE/CONSENT/GRIEVANCE/OTHER; Grievance Officer details render from configuration on the public pages — missing details show an honest notice. |
| §14 | Duty of processing before erasure request (retention for legal purposes) | Deletion endpoint documents honest limits (backups/lawful retention) instead of claiming instantaneous erasure everywhere. |

### Phased commencement — recorded schedule

The DPDP Act is in force in phases via government notifications; the final
remaining provisions are scheduled to commence in **May 2027** (per the
notifications reviewed as of 23 November 2026).

- **Already effective at review date:** core definitional and limited provisions
  commenced with earlier notifications; the Digital Personal Data Protection
  Rules, 2025 (see §B) carry their own phased commencement.
- **Scheduled May 2027:** the remaining substantive obligations that the Rules
  phase in (full consent-manager interoperability expectations, remaining
  fiduciary duties where they activate with the Rules' final phase).

**TO VERIFY before public launch:** pin the exact commenced-section list and
Rule-phase dates against the official gazette notifications (MeitY) and
dpdpa.gov.in at release time. This document intentionally does not enumerate
them from memory.

### Implementation prepared for the May 2027 commencement

1. Versioned notice + purpose-specific consent infrastructure (live).
2. Access / correction / erasure / grievance controls (live).
3. Retention-exception documentation pattern (live — operator windows TO VERIFY).
4. Verifiable parental consent architecture (designed, not operational — see §C).
5. Data-protection contact publication (live via configuration; values TO SUPPLY by owner).

---

## B. Digital Personal Data Protection Rules, 2025

Final notified Rules with **phased commencement**; the last phase aligns with
the May 2027 substantive-commencement window.

Build-toward items and BEAN's current position:

| Rules requirement | BEAN status |
| --- | --- |
| Independent, clear itemised privacy notice | Live — separate Privacy Policy page, sectioned, versioned; no bundling with Terms. |
| Purpose-specific consent | Live infrastructure (ConsentRecord); **no optional purposes are currently offered**, so nothing is bundled. |
| Easy consent withdrawal | Live (per-purpose withdrawal model + privacy-request channel); the withdrawal UI activates automatically when optional purposes are introduced. |
| Access and erasure controls | Live (export v2 + deletion workflow with preview). |
| Processor safeguards | Contract-level responsibility of the operator. Current processors: AI model provider (Riishe/BEAN chat), LiveKit (classrooms, only when configured), Google (OAuth, only when configured), operator-managed hosting/database. **TO VERIFY:** processor agreements must be executed/verified before launch; the Privacy Policy explicitly does not claim provider training guarantees. |
| Security + breach-handling procedures | Technical controls live; breach procedure **TO DOCUMENT** by operator (notification workflow, timelines from the Rules — TO VERIFY exact windows at commencement). |
| Retention and erasure schedules | Deletion is immediate for owned records; operator backup/lawful-retention windows **TO DOCUMENT** before launch. |
| Published data-protection contact details | Live configuration surface (`BEAN_PRIVACY_CONTACT_EMAIL` etc.); values **TO SUPPLY** by owner. |
| Verifiable parental consent where applicable | Architecture designed (§C); **not operational** — fail-safe blocks under-18 accounts meanwhile. |

**Not done (deliberately):** treating the Terms checkbox as consent to every
optional purpose — the implementation refuses to bundle.

---

## C. Children and safeguarding

BEAN supports school-level learners; the DPDP Act's child definition is under
18 — school learners cannot be assumed adult.

**Implemented now**

1. Age self-declaration at signup (`ADULT_18_PLUS` | `UNDER_18`); only the
   adult band is ever stored; no date of birth is collected (no Aadhaar, ID
   scans or unnecessary DOB "for convenience").
2. Under-18 personal-data account activation is **refused** with an honest
   explanation (guardian verification unavailable) — fail-safe, nothing stored.
3. No targeted advertising and no behavioural tracking of children — there are
   no ads or tracking SDKs anywhere in the product (audited).
4. Guest mode cannot bypass the gate: it creates no personal-data account and
   no child data is stored server-side under an identity.
5. Existing Phase 7/6 safeguarding (complaints, appeals, classroom safety)
   untouched and preserved.

**Verifiable-parental-consent architecture (designed, pre-May-2027)**

- A verified-guarantor workflow (government-token via DPDP Consent Manager or
  equivalent offline verification) — NOT a checkbox, NOT email-only OTP; the
  product must never label a checkbox or email step as verifiable consent.
- Age assurance minimalism: declaration now; verified assurance only when the
  guardian flow ships; no biometrics, no ID vault.
- Educational-institution exemption: **not assumed.** Any exemption under the
  Rules must be justified against the real operating model (BEAN is a private
  platform open to the public, not a school-controlled service). TO VERIFY
  with counsel before relying on any exemption.
- Until the guardian mechanism is real, under-18 personal-data accounts fail
  safe (refused).

**Operational status:** documented in the milestone readiness doc
(`docs/PUBLIC-EXPERIENCE-AUTH-LEGAL-READINESS.md` §Child-safeguarding).

---

## D. IT Intermediary Rules, 2021 — as amended February 2026

**Applicability assessment.** BEAN hosts user-generated content (reviews,
complaints, career portfolios, institution resources, teacher profiles) and
runs a class marketplace — it plausibly qualifies as an **intermediary** for
those services. The assessment below is BEAN's own; the formal conclusion must
be confirmed by counsel.

Prepared elements (live or configuration-ready):

| Rule requirement | BEAN status |
| --- | --- |
| Published rules and user agreement | Terms and Conditions page (public, versioned) + Trust & Safety policy preserved. |
| Privacy policy | Privacy Policy page (public, versioned). |
| Grievance Officer details | Configuration surface live; **values TO SUPPLY** by owner; pages show honest "to be provided" notices meanwhile. |
| Accessible complaint mechanism | In-product complaint infrastructure (Trust & Safety) + privacy-request channel. |
| Acknowledgement and resolution tracking | Complaint statuses (OPEN → ACKNOWLEDGED → … → RESOLVED) exist for class complaints; privacy-request statuses (OPEN/ACKNOWLEDGED/RESOLVED). **The applicable acknowledgement/resolution deadlines come from the February 2026 amendment — do NOT copy pre-amendment deadlines. TO VERIFY the current deadlines from the amended text before publication.** |
| Content removal and escalation | Admin moderation routes (reviews, complaints, appeals, career moderation) preserved from Phases 6–7. |

**Deliberately absent:** any claim that BEAN is a "significant social media
intermediary" or any Section 79 safe-harbour boast. Applicability is stated as
a prepared assessment, not a legal conclusion.

---

## E. Consumer Protection (E-Commerce) Rules

**Applicability assessment.** BEAN Teach lists teachers and classes and takes
bookings. No payments are processed (free pilot; monetisation is a separate,
owner-approved milestone). Whether BEAN qualifies as an "e-commerce entity"
must be assessed against the amended Rules — **TO VERIFY with counsel**; this
document does not assert applicability.

The 2026 amendment is scheduled to commence **1 January 2027**. Preparedness
items if applicable:

- Legal identity and contact disclosures — same configuration surface as §A/D
  (operator name, address, consumer support) — values TO SUPPLY.
- Customer-support and grievance handling — consumer-support fields live in
  configuration; grievance channel live.
- Amended acknowledgement/redressal timelines — TO VERIFY from the amendment
  text once it commences; no obsolete deadline is hard-coded.

---

## F. Legal accuracy constraints (enforced in product)

The public pages and this milestone enforce:

1. No claim of government approval, certification or guaranteed legal
   compliance.
2. No guaranteed examination results anywhere.
3. No invented legal-entity identity — the operator renders "to be provided"
   notices until the owner supplies details (`scripts/legal-release-check.mjs`
   lists every missing item; `--strict` blocks a legal-publication release).
4. No invented hosting locations, retention periods or privacy guarantees.
5. No claim that an AI provider never trains on submitted content.
6. A clear marker that all documents are pending Indian legal review — the
   default shipped versions are `*-draft` and render a visible draft badge.

## Owner-supplied information still required before public legal publication

1. `BEAN_LEGAL_ENTITY_NAME` — the actual contracting/legal operator.
2. `BEAN_LEGAL_ENTITY_ADDRESS` — registered address.
3. `BEAN_CONSUMER_SUPPORT_EMAIL` / `BEAN_CONSUMER_SUPPORT_PHONE`.
4. `BEAN_GRIEVANCE_OFFICER_NAME` / `BEAN_GRIEVANCE_EMAIL` / `BEAN_GRIEVANCE_PHONE`.
5. `BEAN_PRIVACY_CONTACT_EMAIL`.
6. `BEAN_TERMS_VERSION` / `BEAN_PRIVACY_VERSION` — once counsel approves the
   texts (replacing the draft versions).
7. Processor agreements to verify (AI provider training behaviour, LiveKit,
   hosting/backup specifics and retention windows).
8. The February 2026 IT-Rules amendment deadlines and the E-Commerce amendment
   applicability conclusion, pinned to the official texts.
