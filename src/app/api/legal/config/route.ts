import { NextResponse } from 'next/server'
import { publicLegalConfig } from '@/lib/legal-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — public, secret-free legal configuration: current policy versions and
// whichever operator/grievance details the owner has configured. Missing
// details come back as null — the public pages render an honest draft notice
// and never invent an address or contact.
export async function GET() {
  return NextResponse.json(publicLegalConfig(), { headers: { 'Cache-Control': 'no-store' } })
}
