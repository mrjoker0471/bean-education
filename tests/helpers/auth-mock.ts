// Complete '@/lib/auth' module mock for route tests.
//
// Why this exists: bun (1.3.14) keeps the first mock.module registration of a
// module alive for the whole test process. A PARTIAL auth mock in an early
// file (e.g. only requireStudent + sameOrigin) breaks later test files that
// bind any other auth export — the file fails to evaluate with
// "SyntaxError: Export named '...' not found" between tests.
// Every test that mocks '@/lib/auth' therefore must provide the FULL export
// surface of src/lib/auth.ts; this helper keeps that surface in one place so
// a new auth export can never re-introduce the leak. Per-test behaviour is
// passed as overrides and always wins over the defaults.

export function completeAuthMock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    SESSION_COOKIE: 'bean_session',
    hashPassword: async () => 'scrypt$16384$8$1$mocksalt$' + 'm'.repeat(86),
    verifyPassword: async () => true,
    newSessionToken: () => 'test-session-token',
    hashToken: () => 'test-session-token-hash',
    createSession: async () => ({ token: 'test-session-token', expiresAt: new Date(Date.now() + 86_400_000) }),
    setSessionCookie: async () => undefined,
    clearSessionCookie: async () => undefined,
    getSessionStudent: async () => null,
    destroyCurrentSession: async () => undefined,
    sameOrigin: () => true,
    requireStudent: async () => null,
    resolveOwnerScope: async (explicitGuestId: string | null) => ({ guestId: explicitGuestId, studentId: null }),
    ownedBy: (scope: { guestId?: string | null; studentId?: string | null }) => {
      const or: Record<string, unknown>[] = []
      if (scope.guestId) or.push({ guestId: scope.guestId })
      if (scope.studentId) or.push({ studentId: scope.studentId })
      if (or.length === 0) return { id: '___no_owner___' }
      return or.length === 1 ? or[0] : { OR: or }
    },
    ...overrides,
  }
}
