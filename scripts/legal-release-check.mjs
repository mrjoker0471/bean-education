#!/usr/bin/env node
// ─── Legal publication release check ──────────────────────────────────────────
// Production release gate for the legal pages (public-experience/auth/legal
// milestone). Verifies that the legal operator identity and grievance details
// required before PUBLIC legal publication are configured in the environment.
//
// Usage:
//   node scripts/legal-release-check.mjs           # warn-only: lists missing items, exit 0
//   node scripts/legal-release-check.mjs --strict  # blocks (exit 1) while items are missing
//
// Ordinary development and CI do NOT run this — missing owner details must not
// break local development or the standard pipeline (milestone rule). Wire the
// --strict mode into a legal-publication release workflow once the owner
// supplies the real details.

const REQUIRED = [
  { env: 'BEAN_LEGAL_ENTITY_NAME', label: 'Legal entity name (contracting operator)' },
  { env: 'BEAN_LEGAL_ENTITY_ADDRESS', label: 'Legal entity registered address' },
  { env: 'BEAN_CONSUMER_SUPPORT_EMAIL', label: 'Consumer support email' },
  { env: 'BEAN_GRIEVANCE_OFFICER_NAME', label: 'Grievance Officer name' },
  { env: 'BEAN_GRIEVANCE_EMAIL', label: 'Grievance Officer email' },
  { env: 'BEAN_PRIVACY_CONTACT_EMAIL', label: 'Privacy contact email' },
]

const strict = process.argv.includes('--strict')
const missing = REQUIRED.filter(r => !process.env[r.env] || process.env[r.env].trim() === '')

if (missing.length === 0) {
  console.log('[legal-release-check] All required legal identity/contact details are configured.')
  process.exit(0)
}

console.log('[legal-release-check] Missing legal publication details:')
for (const item of missing) {
  console.log(`  - ${item.label} (${item.env})`)
}
if (strict) {
  console.log('[legal-release-check] STRICT mode: blocking legal-publication release until the details above are supplied.')
  process.exit(1)
}
console.log('[legal-release-check] Warn-only mode: not blocking. Public legal pages will show an honest "to be provided" notice.')
process.exit(0)
