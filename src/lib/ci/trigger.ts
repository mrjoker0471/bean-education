// ─── BEAN Classroom Intelligence (CI-1B): consent + trigger wiring ───────────
// Consent: the teacher-level opt-in gate, stored on the EXISTING ConsentRecord
// model (purpose CLASSROOM_INTELLIGENCE_TEACHER). Grant/withdraw are
// independent, append-friendly records; withdrawal never deletes history —
// it only stops future evaluations immediately (checked at enqueue AND claim).
//
// Triggers: the ONLY hooks into the existing classroom lifecycle. Both are
// post-transaction, error-isolated `void` calls: they can never fail, delay
// or invalidate the classroom operation that triggered them (live/end route,
// LiveKit room_finished webhook). Evaluation creation is consent-gated
// server-side; without consent nothing is created and nothing is logged
// beyond the queue's own honest outcome.

import { db } from '@/lib/db'
import { CI_CONSENT_PURPOSE, CI_TRIGGER } from './constants'
import { enqueueEvaluation } from './queue'
import { ensureCiWorker } from './queue'
// Register the real multi-agent pipeline as a side effect of importing this
// module: every route that touches the classroom lifecycle (both import this
// trigger module) therefore has the evaluation pipeline available. The
// pipeline module never imports back here — no circular dependency.
import './pipeline'

export interface CiConsentState {
  granted: boolean
  grantedAt: string | null
  withdrawnAt: string | null
}

/** Resolve the teacher's current CI consent state (honest: may be never-granted). */
export async function getCiConsentState(teacherStudentId: string): Promise<CiConsentState> {
  const record = await db.consentRecord.findFirst({
    where: { studentId: teacherStudentId, purpose: CI_CONSENT_PURPOSE },
    orderBy: { grantedAt: 'desc' },
  })
  if (!record) return { granted: false, grantedAt: null, withdrawnAt: null }
  return {
    granted: record.granted && record.withdrawnAt === null,
    grantedAt: record.grantedAt.toISOString(),
    withdrawnAt: record.withdrawnAt ? record.withdrawnAt.toISOString() : null,
  }
}

/** Grant CI consent for the teacher account. Idempotent. */
export async function grantCiConsent(teacherStudentId: string): Promise<CiConsentState> {
  const existing = await db.consentRecord.findFirst({
    where: { studentId: teacherStudentId, purpose: CI_CONSENT_PURPOSE, granted: true, withdrawnAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  if (!existing) {
    await db.consentRecord.create({
      data: { studentId: teacherStudentId, purpose: CI_CONSENT_PURPOSE, granted: true },
    })
  }
  return getCiConsentState(teacherStudentId)
}

/**
 * Withdraw CI consent for the teacher account. Idempotent. Withdrawal stops
 * future evaluations immediately; existing reports remain until the teacher
 * deletes them or the account is deleted (documented in the privacy doc).
 */
export async function withdrawCiConsent(teacherStudentId: string): Promise<CiConsentState> {
  const active = await db.consentRecord.findFirst({
    where: { studentId: teacherStudentId, purpose: CI_CONSENT_PURPOSE, granted: true, withdrawnAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  if (active) {
    await db.consentRecord.update({
      where: { id: active.id },
      data: { withdrawnAt: new Date() },
    })
  }
  return getCiConsentState(teacherStudentId)
}

// ─── Lifecycle triggers (error-isolated, never blocking) ──────────────────────

/**
 * Fire-and-forget evaluation trigger for a terminal live session.
 * Called AFTER the classroom transaction committed; every failure is caught
 * and logged — a broken evaluation pipeline can never surface as a classroom
 * error to a teacher or student.
 */
export function triggerEvaluationForEndedSession(classSessionId: string, trigger: typeof CI_TRIGGER.SESSION_END | typeof CI_TRIGGER.PROVIDER_ROOM_FINISHED): void {
  void (async () => {
    try {
      const outcome = await enqueueEvaluation({ classSessionId, trigger })
      if (!outcome.queued && outcome.reason !== 'no_consent') {
        // no_consent is the normal, quiet path (consent-gated auto-evaluation);
        // anything else is worth a log line for operators.
        console.log(`[ci trigger] evaluation not queued for class ${classSessionId}: ${outcome.reason}`)
      }
    } catch (err) {
      console.error('[ci trigger] evaluation enqueue failed (classroom operation unaffected)', err instanceof Error ? err.message : err)
    }
  })()
}

/** Ensure the in-process worker is running whenever the app touches CI. */
export function ensureCiRuntimeStarted(): void {
  ensureCiWorker()
}
