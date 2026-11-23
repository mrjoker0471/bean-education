# BEAN Classroom Intelligence — Future Payments Integration Boundary (CI-1F)

**Status**: design document. BEAN Teach operates a **free pilot** — no payment
collection, teacher payouts, commissions or refunds exist anywhere in the
product today (docs/ARCHITECTURE.md; `plannedPricePaise` is stored as metadata
only and is never charged). This document defines the boundary that keeps
future money movement safely separate from AI evaluation. Nothing in this
document is implemented in CI-1; no payment code exists on this branch.

---

## 1. The invariant (non-negotiable)

**AI quality scores must never independently determine whether an otherwise
eligible teacher gets paid.**

Payout eligibility may be derived only from transparent, published, objectively
verifiable class-completion facts. Classroom Intelligence outputs are advisory
evidence for humans — they are not a payout gate.

## 2. The factual basis a future payout system may use

These all exist today as verified server-side facts (no AI involved):

| Fact | Source of truth (today) |
|---|---|
| Verified class completion | `ClassSession.status` (`COMPLETED`), live session `ENDED`/`INTERRUPTED` with single-use usage finalisation |
| Verified attendance requirements | `ClassBooking.status` `ATTENDED`/`NO_SHOW` — teacher-marked after class end (server-checked), backed by webhook-verified `LiveClassParticipant` connection intervals |
| Existing booking status | `ClassBooking` (transactional seat claims, cancellation-safe reactivation) |
| Valid cancellation handling | `ClassSession.cancelledAt`, booking `CANCELLED` state, append-only `TeachAuditEvent` |
| Authorised dispute resolution | `TeachComplaint` + append-only `ComplaintEvent`; `TeachAppeal` with independent review (`originalDecisionById` self-review ban) |

## 3. The boundary rules (for whoever implements payments later)

1. **Separate domain modules.** A payout engine reads booking/class/attendance
   facts through its own service layer. It must not import
   `src/lib/ci/**` — enforced by convention here and trivially reviewable.
2. **No AI-derived payout state.** `ClassroomEvaluationReport` rows (including
   `requiresHumanReview`, `insufficientEvidence`, findings, suggestions) are
   NEVER inputs to payout calculations, holds or clawbacks.
3. **Disputes do not gate payouts.** A `ClassroomEvaluationDispute` affects
   only the report version lifecycle (CORRECTED rebuild / RETRACTED hiding).
   It can never pause, reduce or reverse a payout.
4. **Human trust decisions stay in Trust & Safety.** If a future system wants
   trust-related payout holds, the source must be the existing human-decided
   `TrustAction` records — never CI output, and never automatic.
5. **Transparency**: whatever eligibility rules are chosen must be published to
   teachers in plain language before activation, and every payout decision must
   be auditable to its factual inputs (booking/attendance/class records).
6. **Free pilot honesty**: until payments ship, every payment-adjacent UI string
   must keep saying the pilot is free (existing convention:
   `FREE_PILOT_PRICE_LABEL`).

## 4. What CI may legitimately contribute (advisory only)

- Teachers may *read* their evaluation history; nothing prevents a teacher from
  choosing to improve. That is the entire intended influence of CI on earnings:
  better teaching → happier students → more bookings, through normal market
  mechanisms — never through an automated score gate.
- If a future dashboard wants to *display* (never enforce) completion stats,
  it must display the same verified facts listed in §2, not AI scores.

## 5. Integration sketch (documented, not built)

```
Future payouts service
  ├─ reads: ClassSession / ClassBooking / LiveClassParticipant / TrustAction
  │         (verified facts only)
  ├─ NEVER reads: ClassroomEvaluationReport / ClassroomAgentRun /
  │               ClassroomEvaluationDispute / ClassroomStudentSummary
  └─ authorisation: separate explicit admin payout decisions with their own
                    append-only audit trail
```
