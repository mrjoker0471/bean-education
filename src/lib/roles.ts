// ─── Role authorization (Phase 2B, server-only) ────────────────────────────────
// Single source of truth for role-based access control. Roles live on the
// Student row (`Student.role`); there is deliberately NO API that can raise a
// role — promotion happens exclusively through the operator CLI
// (scripts/grant-role.ts), which runs on the server with direct DB access.
//
// Role model:
//   STUDENT     — default for every registration; the everyday learner.
//   PYQ_CURATOR — may import structured PYQ papers and review (approve/reject)
//                 imported PYQ rows in the curation workspace.
//   ADMIN       — everything a curator can do; reserved for operators.
//
// The decision helpers below are PURE functions so the authorization matrix is
// unit-testable without a database or HTTP layer (see tests/unit/roles.test.ts
// and tests/unit/pyq-review-route.test.ts for the enforced proofs).

import { requireStudent, type AuthStudent } from '@/lib/auth'

export const ROLES = ['STUDENT', 'PYQ_CURATOR', 'ADMIN'] as const
export type Role = (typeof ROLES)[number]

/** Roles allowed to import PYQ papers and review PYQ rows. */
export const PYQ_CURATOR_ROLES: readonly Role[] = ['PYQ_CURATOR', 'ADMIN'] as const

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Pure: does `role` satisfy the allowed list? */
export function hasRole(role: Role | string | null | undefined, allowed: readonly Role[]): boolean {
  if (!role) return false
  return (allowed as readonly string[]).includes(role)
}

export interface Denial {
  status: 401 | 403
  error: string
}

/**
 * Pure: evaluate the authorization decision for a (possibly signed-out) student
 * against an allowed-roles list.
 *   • signed out                    → 401 (identity missing, not forbidden)
 *   • signed in without the role    → 403 (identity known, action forbidden)
 *   • signed in with the role       → null (allowed)
 */
export function roleDenial(
  student: Pick<AuthStudent, 'role'> | null | undefined,
  allowed: readonly Role[],
): Denial | null {
  if (!student) {
    return { status: 401, error: 'Sign in required' }
  }
  if (!hasRole(student.role, allowed)) {
    return {
      status: 403,
      error:
        'You do not have permission to perform this action. PYQ curation is restricted to authorised curators — contact the BEAN operators if you need access.',
    }
  }
  return null
}

/**
 * Guard for privileged PYQ endpoints (import / review / batch listing).
 * Returns either the authenticated curator/admin or a ready-to-send denial.
 */
export async function requirePyqCurator(): Promise<
  { ok: true; student: AuthStudent } | { ok: false; status: 401 | 403; error: string }
> {
  const student = await requireStudent()
  const denial = roleDenial(student, PYQ_CURATOR_ROLES)
  if (denial) return { ok: false, status: denial.status, error: denial.error }
  return { ok: true, student: student as AuthStudent }
}
