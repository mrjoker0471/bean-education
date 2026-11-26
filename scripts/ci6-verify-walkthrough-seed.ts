// ─── CI-6 verification walkthrough seeding (uncommitted local tooling) ───────
// Seeds clearly-labelled fixture accounts into an ISOLATED disposable DB for
// the authenticated expert-network browser walkthrough. Production databases
// are never touched: DATABASE_URL must point at the throwaway file.
//
//   ci6-admin@bean.test       ADMIN (role granted by direct seed — the only path)
//   ci6-applicant@bean.test   STUDENT (applies through the real API in the flow)
//   ci6-second@bean.test      STUDENT (second admin-actor + reviewer B fixtures)
// Password: bean-ci6-demo
//
// Fixtures are clearly labelled (display names carry "(fixture)") and the DB is
// disposable — nothing here is a real expert, credential, verification or
// approval, and none of it ever reaches a production ledger.
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
const DEMO_PASSWORD = 'bean-ci6-demo'

async function main(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const admin = await db.student.upsert({
    where: { email: 'ci6-admin@bean.test' },
    update: { passwordHash },
    create: { email: 'ci6-admin@bean.test', passwordHash, displayName: 'CI-6 Verify Admin (fixture)', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), role: 'ADMIN' },
  })
  const applicant = await db.student.upsert({
    where: { email: 'ci6-applicant@bean.test' },
    update: { passwordHash },
    create: { email: 'ci6-applicant@bean.test', passwordHash, displayName: 'CI-6 Verify Applicant (fixture)', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  const second = await db.student.upsert({
    where: { email: 'ci6-second@bean.test' },
    update: { passwordHash },
    create: { email: 'ci6-second@bean.test', passwordHash, displayName: 'CI-6 Verify Second Admin (fixture)', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), role: 'ADMIN' },
  })
  await db.student.upsert({
    where: { email: 'ci6-reviewer@bean.test' },
    update: { passwordHash },
    create: { email: 'ci6-reviewer@bean.test', passwordHash, displayName: 'CI-6 Verify Reviewer (fixture)', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  console.log('seeded fixture accounts:', admin.email, applicant.email, second.email, '(disposable DB — no real experts)')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
