// ─── BEAN Phase 7 UI: pure helpers for the group detail workspace ────────────
// Client-safe, side-effect-free helpers shared by the group workspace view
// (#/institution/:orgId/groups/:groupId). Extracted here (instead of living in
// the component) so the candidate-list and scoping rules are unit-testable and
// stay consistent with the server's enrollment rules:
//   • Only ACTIVE organization members may be enrolled.
//   • A member whose enrollment row is LEFT may be re-enrolled (the server
//     re-activates the historical row — history is never deleted).

import type { MemberDTO } from './types'
import type { GroupRosterEntryDTO } from './institution-dto'

/** Scope a list of organization items to one group. Assignments,
 *  announcements and resources carry `groupId`; class rows carry
 *  `organizationGroupId` — pass the matching accessor as `pick`. */
export function filterByGroupId<T>(items: T[], groupId: string, pick: (item: T) => string | null): T[] {
  return items.filter(item => pick(item) === groupId)
}

/** The enrollment dialog's candidate list: ACTIVE organization members who are
 *  not currently enrolled (rows already LEFT are eligible again). */
export function enrollCandidates(members: MemberDTO[], roster: GroupRosterEntryDTO[]): MemberDTO[] {
  const activelyEnrolled = new Set(
    roster.filter(entry => entry.enrollmentState === 'ACTIVE').map(entry => entry.membershipId),
  )
  return members.filter(m => m.status === 'ACTIVE' && !activelyEnrolled.has(m.id))
}

/** membershipId → organization role. Roster DTOs carry display names only;
 *  the org role badge comes from the members list (same privacy contract). */
export function buildRoleIndex(members: MemberDTO[]): Map<string, string> {
  return new Map(members.map(m => [m.id, m.role]))
}
