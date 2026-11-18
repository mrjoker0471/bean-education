import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// SQL query logging is opt-in via DB_QUERY_LOG=1 — never unconditional.
// Query logs can contain user content bound into statements, so production
// must stay silent unless an operator deliberately enables diagnostics.
const enableQueryLog = process.env.DB_QUERY_LOG === '1'

function createClient(): PrismaClient {
  if (!enableQueryLog) return new PrismaClient()
  return new PrismaClient({ log: ['query'] })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
