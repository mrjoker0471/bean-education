import { describe, it, expect } from 'bun:test'
import { hasRole, roleDenial, PYQ_CURATOR_ROLES, ROLES } from '@/lib/roles'

// Phase 2B Milestone A: the authorization matrix for PYQ curation. These are
// the pure decision functions the API guards delegate to — if these pass, the
// role math itself is correct; the route-level tests then prove the routes
// actually call them.

describe('roles: ROLES vocabulary', () => {
  it('exposes exactly the three sanctioned roles', () => {
    expect(ROLES).toEqual(['STUDENT', 'PYQ_CURATOR', 'ADMIN'])
  })

  it('grants PYQ curation only to PYQ_CURATOR and ADMIN', () => {
    expect([...PYQ_CURATOR_ROLES].sort()).toEqual(['ADMIN', 'PYQ_CURATOR'])
  })
})

describe('roles: hasRole', () => {
  it('matches a role in the allowed list', () => {
    expect(hasRole('PYQ_CURATOR', PYQ_CURATOR_ROLES)).toBe(true)
    expect(hasRole('ADMIN', PYQ_CURATOR_ROLES)).toBe(true)
  })

  it('refuses roles outside the allowed list', () => {
    expect(hasRole('STUDENT', PYQ_CURATOR_ROLES)).toBe(false)
  })

  it('refuses missing, empty or unknown roles', () => {
    expect(hasRole(null, PYQ_CURATOR_ROLES)).toBe(false)
    expect(hasRole(undefined, PYQ_CURATOR_ROLES)).toBe(false)
    expect(hasRole('', PYQ_CURATOR_ROLES)).toBe(false)
    expect(hasRole('SUPERUSER', PYQ_CURATOR_ROLES)).toBe(false)
  })
})

describe('roles: roleDenial (the matrix enforced by every PYQ endpoint)', () => {
  it('a signed-out visitor gets 401 (identity missing — not forbidden)', () => {
    const denial = roleDenial(null, PYQ_CURATOR_ROLES)
    expect(denial).not.toBeNull()
    expect(denial?.status).toBe(401)
  })

  it('a plain STUDENT gets 403 for privileged PYQ actions', () => {
    const denial = roleDenial({ role: 'STUDENT' }, PYQ_CURATOR_ROLES)
    expect(denial).not.toBeNull()
    expect(denial?.status).toBe(403)
    expect(denial?.error).toContain('curator')
  })

  it('a PYQ_CURATOR is allowed', () => {
    expect(roleDenial({ role: 'PYQ_CURATOR' }, PYQ_CURATOR_ROLES)).toBeNull()
  })

  it('an ADMIN is allowed', () => {
    expect(roleDenial({ role: 'ADMIN' }, PYQ_CURATOR_ROLES)).toBeNull()
  })

  it('an unknown/spoofed role value gets 403, never access', () => {
    expect(roleDenial({ role: 'SUPERADMIN' }, PYQ_CURATOR_ROLES)?.status).toBe(403)
    expect(roleDenial({ role: '' }, PYQ_CURATOR_ROLES)?.status).toBe(403)
  })

  it('401 vs 403 distinction: signed-out is 401 even for admin-only lists', () => {
    expect(roleDenial(null, ['ADMIN'])?.status).toBe(401)
    expect(roleDenial({ role: 'PYQ_CURATOR' }, ['ADMIN'])?.status).toBe(403)
    expect(roleDenial({ role: 'ADMIN' }, ['ADMIN'])).toBeNull()
  })
})
