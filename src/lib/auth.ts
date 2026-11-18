// ─── Student identity & sessions (Phase 2A, server-only) ─────────────────────
// Security model:
//   • Passwords: scrypt (N=16384, r=8, p=1) with a 16-byte random salt and a
//     64-byte derived key, stored as "scrypt$N$r$p$salt$hash". Plaintext
//     passwords are never stored, logged or returned.
//   • Sessions: a random 256-bit token is issued ONCE to an httpOnly cookie;
//     the database stores only its SHA-256 hash. Token lookup uses
//     timing-safe comparison implicitly (hash equality), and a compromised
//     database cannot be used to forge cookies.
//   • Session expiry: 30 days; renewal happens on activity (sliding window).
//   • Mutating auth endpoints require same-origin (CSRF-lite) and cookies are
//     SameSite=Lax + Secure in production.
// This module is the single source of truth for session handling; routes must
// not roll their own token logic.

import { db } from '@/lib/db'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

export const SESSION_COOKIE = 'bean_session'
const SESSION_TTL_MS = 30 * 24 * 3600_000
const SCRYPT = { N: 16384, r: 8, p: 1 } as const

export interface AuthStudent {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
}

// ─── Passwords ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const N = Number(nStr), r = Number(rStr), p = Number(pStr)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  if (expected.length < 32) return false
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

// ─── Sessions ───────────────────────────────────────────────────────────────────

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(studentId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { tokenHash: hashToken(token), studentId, expiresAt } })
  return { token, expiresAt }
}

/** Write the session cookie (call inside a Route Handler). */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  })
}

/** Clear the session cookie (call inside a Route Handler). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: new Date(0), path: '/' })
}

/** Resolve the signed-in student from the session cookie (or null for guests). */
export async function getSessionStudent(): Promise<AuthStudent | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { student: { select: { id: true, email: true, displayName: true, learningLevel: true } } },
  })
  if (!row || row.expiresAt.getTime() < Date.now()) return null
  // Sliding renewal: extend when more than half the TTL has elapsed
  if (row.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2) {
    await db.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastUsedAt: new Date() } }).catch(() => undefined)
  }
  return row.student
}

/** Destroy the current session (logout / account deletion). */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => undefined)
  }
  await clearSessionCookie()
}

// ─── Request guards ─────────────────────────────────────────────────────────────

/** CSRF-lite guard for mutating auth endpoints: when a browser sends an Origin
 *  header it must match the request host. Non-browser clients (no Origin) pass. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(req.url).host
  } catch {
    return false
  }
}

/** Require a signed-in student; returns null when unauthenticated. */
export async function requireStudent(): Promise<AuthStudent | null> {
  return getSessionStudent()
}

// ─── Guest ownership (shared identity model) ────────────────────────────────────
// Owned rows carry BOTH guestId (guest identity, unchanged) and an optional
// studentId. Ownership check for any row: row.guestId === guestId, OR a signed
// session exists and row.studentId === student.id. Guest data stays intact; a
// signed-in student claims rows by setting studentId (never by rewriting the
// guest identity).

export interface OwnerScope {
  guestId: string | null
  studentId: string | null
}

export async function resolveOwnerScope(explicitGuestId: string | null): Promise<OwnerScope> {
  const student = await getSessionStudent()
  return { guestId: explicitGuestId, studentId: student?.id ?? null }
}

/** Prisma where-fragment matching rows owned by this guest or student. */
export function ownedBy(scope: OwnerScope, guestField = 'guestId', studentField = 'studentId'): Record<string, unknown> {
  const or: Record<string, unknown>[] = []
  if (scope.guestId) or.push({ [guestField]: scope.guestId })
  if (scope.studentId) or.push({ [studentField]: scope.studentId })
  if (or.length === 0) return { id: '___no_owner___' } // matches nothing — honest empty scope
  return or.length === 1 ? or[0] : { OR: or }
}
