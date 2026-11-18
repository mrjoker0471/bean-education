// ─── Operator CLI: grant / revoke student roles — Phase 2B ─────────────────────
// The ONLY sanctioned way to create a PYQ_CURATOR or ADMIN. There is no HTTP
// endpoint that can raise a role: this script runs on the server (or wherever
// the operator holds the database) and talks to the database directly.
//
// Usage:
//   bun scripts/grant-role.ts --email=ops@example.com --role=PYQ_CURATOR          # dry-run preview
//   bun scripts/grant-role.ts --email=ops@example.com --role=PYQ_CURATOR --yes    # apply
//   bun scripts/grant-role.ts --email=ops@example.com --role=STUDENT --yes        # revoke to STUDENT
//   bun scripts/grant-role.ts --list                                              # privileged accounts
//   bun scripts/grant-role.ts --list-all                                          # every account + role
//
// Safety properties:
//   • Valid roles only (STUDENT | PYQ_CURATOR | ADMIN) — anything else exits 2.
//   • Default is a dry-run preview; nothing is written without --yes.
//   • Demotions are allowed (role recovery) but always printed with a warning.
//   • Every action is printed with before → after; run output is the audit log.
//   • Initial ADMIN provisioning: run this once against the database for the
//     operator's own account (see docs/PHASE2B_SECURITY.md § Provisioning).

import { PrismaClient } from '@prisma/client'

const ROLES = ['STUDENT', 'PYQ_CURATOR', 'ADMIN'] as const
type Role = (typeof ROLES)[number]

function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v)
}

async function main() {
  const args = process.argv.slice(2)
  const list = args.includes('--list')
  const listAll = args.includes('--list-all')
  const apply = args.includes('--yes')
  const emailArg = args.find(a => a.startsWith('--email='))
  const roleArg = args.find(a => a.startsWith('--role='))

  const db = new PrismaClient()

  try {
    if (list || listAll) {
      const students = await db.student.findMany({
        where: list ? { role: { not: 'STUDENT' } } : {},
        select: { email: true, role: true, createdAt: true },
        orderBy: [{ role: 'asc' }, { email: 'asc' }],
      })
      if (students.length === 0) {
        console.log(list ? 'No privileged accounts (everything is STUDENT).' : 'No accounts exist yet.')
        return
      }
      console.log(`Accounts${list ? ' with elevated roles' : ''}:`)
      for (const s of students) {
        console.log(`  ${s.email.padEnd(40)} ${s.role.padEnd(12)} (joined ${s.createdAt.toISOString().slice(0, 10)})`)
      }
      return
    }

    if (!emailArg || !roleArg) {
      console.error('Usage: bun scripts/grant-role.ts --email=<email> --role=<STUDENT|PYQ_CURATOR|ADMIN> [--yes]')
      console.error('       bun scripts/grant-role.ts --list | --list-all')
      process.exit(2)
    }

    const email = emailArg.split('=')[1].trim().toLowerCase()
    const role = roleArg.split('=')[1].trim().toUpperCase()

    if (!isRole(role)) {
      console.error(`Unknown role "${role}". Valid roles: ${ROLES.join(' | ')}`)
      process.exit(2)
    }
    if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      console.error(`Invalid email "${email}".`)
      process.exit(2)
    }

    const student = await db.student.findUnique({ where: { email }, select: { id: true, email: true, role: true } })
    if (!student) {
      console.error(`No account found for ${email}. The account must register through the app first.`)
      process.exit(1)
    }

    if (student.role === role) {
      console.log(`${email} already holds ${role}. Nothing to do.`)
      return
    }

    const demoting = student.role === 'ADMIN' && role !== 'ADMIN'

    console.log('Role change preview')
    console.log(`  account:  ${email} (${student.id})`)
    console.log(`  role:     ${student.role} → ${role}`)
    if (demoting) console.log('  WARNING:  this DEMOTES an ADMIN — make sure at least one other ADMIN remains.')
    if (!apply) {
      console.log('\nDry run — nothing written. Re-run with --yes to apply.')
      return
    }

    const updated = await db.student.update({
      where: { id: student.id },
      data: { role },
      select: { email: true, role: true },
    })

    // Leave at least one ADMIN alive when demoting (operator safety net).
    if (role !== 'ADMIN') {
      const adminsLeft = await db.student.count({ where: { role: 'ADMIN' } })
      if (student.role === 'ADMIN' && adminsLeft === 0) {
        console.error('Refused: that was the last ADMIN. Recovery: re-run with --role=ADMIN --yes.')
        await db.student.update({ where: { id: student.id }, data: { role: 'ADMIN' } })
        console.error('The previous role (ADMIN) was restored.')
        process.exit(1)
      }
    }

    console.log(`\nApplied: ${updated.email} now holds ${updated.role}.`)
    console.log('Record this change in your operator log (who, when, why) — the script output is the audit trail.')
  } finally {
    await db.$disconnect()
  }
}

void main()
