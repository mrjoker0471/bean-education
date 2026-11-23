// ─── Post-authentication routing (audience intent + teacher lifecycle) ───────
// Pure, testable helper that decides where a freshly authenticated student
// lands. CRITICAL identity rule: the Student/Teacher choice is an onboarding
// and navigation intent ONLY — it can never grant authorization. Teacher
// capability remains an approved TeacherProfile from the existing workflow.
//
// Teacher routing (milestone spec):
//   • No teacher application        → existing teacher application (#/teach/apply)
//   • Application PENDING           → genuine pending status (#/teach/apply)
//   • Application REJECTED          → existing correction/resubmission (#/teach/apply)
//   • Application APPROVED          → teacher dashboard (#/teach/dashboard)
// Student routing:
//   • Not yet onboarded             → onboarding, then dashboard
//   • Onboarded                     → dashboard
// Teacher intent + onboarding: onboarding first, THEN the application
// (handled by onboarding-view finishing into teach-apply for TEACHER intent).

import type { Route } from '@/lib/store'

export type AudienceIntent = 'STUDENT' | 'TEACHER'
export type TeacherApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | null

export interface PostAuthInput {
  /** Navigation intent recorded at signup — never an authorization role. */
  intent: AudienceIntent | string | null | undefined
  /** ISO timestamp once onboarding finished; null until then. */
  onboardedAt: string | null | undefined
  /** Existing teacher application status (server-derived, never client-set). */
  applicationStatus: TeacherApplicationStatus
}

export function postAuthDestination(input: PostAuthInput): Route {
  const teacherIntent = input.intent === 'TEACHER'
  // Teacher intent ALWAYS resolves through the application lifecycle first —
  // even for onboarded accounts. The apply view renders the genuine state:
  // form (no application), pending panel, rejected/resubmission, approved CTA.
  // A NEW teacher-intent registration completes necessary onboarding FIRST
  // (onboarding-view hands off to the application via postOnboardingDestination)
  // — the intent is preserved, never converted into authorization.
  if (teacherIntent) {
    if (!input.onboardedAt) return { view: 'onboarding' }
    if (input.applicationStatus === 'APPROVED') return { view: 'teach-dashboard' }
    return { view: 'teach-apply' }
  }
  if (!input.onboardedAt) return { view: 'onboarding' }
  return { view: 'dashboard' }
}

/** Where onboarding should hand off for the recorded intent. */
export function postOnboardingDestination(intent: AudienceIntent | string | null | undefined): Route {
  return intent === 'TEACHER' ? { view: 'teach-apply' } : { view: 'dashboard' }
}

// ─── Client-side resolution (uses the real application API) ─────────────────

export interface AuthedStudentLike {
  signupIntent?: string | null
  onboardedAt: string | null
}

/** Resolve where a freshly authenticated student lands, checking the REAL
 *  teacher-application state server-side when the intent is TEACHER.
 *  `intentOverride` lets a visitor who chose "Teacher" at sign-in be routed
 *  through the teacher flow — navigation only, never authorization. */
export async function resolvePostAuthRoute(
  student: AuthedStudentLike,
  intentOverride?: AudienceIntent | string | null,
): Promise<Route> {
  const intent = intentOverride ?? student.signupIntent ?? null
  if (intent === 'TEACHER') {
    try {
      const res = await fetch('/api/teach/application', { credentials: 'same-origin' })
      if (res.ok) {
        const data = (await res.json()) as { application?: { status?: string } | null }
        const status = (data.application?.status ?? null) as TeacherApplicationStatus
        return postAuthDestination({ intent, onboardedAt: student.onboardedAt, applicationStatus: status })
      }
    } catch {
      // Network failure — the apply view itself re-fetches and shows the truth.
      return { view: 'teach-apply' }
    }
    return { view: 'teach-apply' }
  }
  return postAuthDestination({ intent, onboardedAt: student.onboardedAt, applicationStatus: null })
}
