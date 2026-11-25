// ─── CI-5 verification walkthrough seeding (uncommitted local tooling) ───────
// Seeds clearly-labelled fixture accounts into an ISOLATED disposable DB for
// the authenticated reviewer/administrator browser walkthrough. Production
// databases are never touched: DATABASE_URL must point at the throwaway file.
//
//   ci5-admin@bean.test     ADMIN (role granted by direct seed — the only path)
//   ci5-reviewer@bean.test  STUDENT (applies through the real API in the flow)
// Password: bean-ci5-demo
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`
}

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DEMO_PASSWORD = 'bean-ci5-demo'

async function main(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const admin = await db.student.upsert({
    where: { email: 'ci5-admin@bean.test' },
    update: { passwordHash },
    create: { email: 'ci5-admin@bean.test', passwordHash, displayName: 'CI-5 Verify Admin (fixture)', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), role: 'ADMIN' },
  })
  const reviewer = await db.student.upsert({
    where: { email: 'ci5-reviewer@bean.test' },
    update: { passwordHash },
    create: { email: 'ci5-reviewer@bean.test', passwordHash, displayName: 'CI-5 Verify Reviewer (fixture)', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  console.log(JSON.stringify({ admin: admin.id, reviewer: reviewer.id, passwordSet: true }))
}

main().then(() => db.$disconnect()).catch((err) => { console.error(err); process.exit(1) })
