// ─── Legal versions, operator identity & grievance configuration ─────────────
// SERVER-SIDE source of truth for the current Terms and Privacy Notice
// versions and the configured legal-operator / grievance details.
//
// Honesty rules (public-experience/auth/legal milestone):
//   • The server NEVER trusts a version supplied by the browser — the versions
//     below are the only ones that satisfy signup/re-acceptance validation.
//   • Operator identity and grievance contacts come exclusively from
//     environment variables. When they are absent the public pages show an
//     honest draft/configuration notice — nothing is ever invented.
//   • Default draft versions mark the policies as pending the owner's Indian
//     legal review; they are NOT a legal opinion.

/** Current Terms and Conditions version (owner-configurable). */
export const CURRENT_TERMS_VERSION = process.env.BEAN_TERMS_VERSION?.trim() || '2026-11-23-draft.1'

/** Current Privacy Policy version (owner-configurable). */
export const CURRENT_PRIVACY_VERSION = process.env.BEAN_PRIVACY_VERSION?.trim() || '2026-11-23-draft.1'

// ─── Document dates (last-updated / effective) ────────────────────────────────
// Owner-configurable via environment, validated strictly. Honesty rules:
//   • Only strict YYYY-MM-DD calendar dates are accepted; anything else is
//     treated as unconfigured — a wrong date is worse than no date.
//   • When no explicit last-updated date is configured, the date stamped in
//     the version identifier is shown (e.g. "2026-11-23-draft.1" → 2026-11-23).
//     That is the version's own stamp, not an invented date.
//   • Effective dates are NEVER derived or defaulted: until the owner configures
//     one (and completes the legal review), the pages state that the document
//     is not yet in effect.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function envDate(name: string): string | null {
  const raw = env(name)
  if (!ISO_DATE_RE.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : raw
}

/** The date component of a version identifier, when it carries one. */
export function versionDate(version: string): string | null {
  const match = version.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const parsed = new Date(`${match[1]}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : match[1]
}

/** True while the shipped versions are still the repository defaults. */
export function legalVersionsAreDraft(): boolean {
  return CURRENT_TERMS_VERSION.startsWith('2026-11-23-draft') || CURRENT_PRIVACY_VERSION.startsWith('2026-11-23-draft')
}

function env(name: string): string {
  return process.env[name]?.trim() ?? ''
}

export interface LegalOperatorConfig {
  entityName: string
  entityAddress: string
  consumerSupportEmail: string
  consumerSupportPhone: string
  grievanceOfficerName: string
  grievanceEmail: string
  grievancePhone: string
  privacyContactEmail: string
  termsVersion: string
  privacyVersion: string
  termsUpdatedAt: string | null
  termsEffectiveDate: string | null
  privacyUpdatedAt: string | null
  privacyEffectiveDate: string | null
}

/** Read the operator/grievance configuration from the environment. Fields the
 *  owner has not supplied stay empty — callers must render an honest notice. */
export function legalOperatorConfig(): LegalOperatorConfig {
  return {
    entityName: env('BEAN_LEGAL_ENTITY_NAME'),
    entityAddress: env('BEAN_LEGAL_ENTITY_ADDRESS'),
    consumerSupportEmail: env('BEAN_CONSUMER_SUPPORT_EMAIL'),
    consumerSupportPhone: env('BEAN_CONSUMER_SUPPORT_PHONE'),
    grievanceOfficerName: env('BEAN_GRIEVANCE_OFFICER_NAME'),
    grievanceEmail: env('BEAN_GRIEVANCE_EMAIL'),
    grievancePhone: env('BEAN_GRIEVANCE_PHONE'),
    privacyContactEmail: env('BEAN_PRIVACY_CONTACT_EMAIL'),
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsUpdatedAt: envDate('BEAN_TERMS_LAST_UPDATED'),
    termsEffectiveDate: envDate('BEAN_TERMS_EFFECTIVE_DATE'),
    privacyUpdatedAt: envDate('BEAN_PRIVACY_LAST_UPDATED'),
    privacyEffectiveDate: envDate('BEAN_PRIVACY_EFFECTIVE_DATE'),
  }
}

/** True once every legally required identity/contact detail has been supplied.
 *  Used by the public pages (draft notice) and scripts/legal-release-check.mjs. */
export function legalContactConfigured(cfg: LegalOperatorConfig = legalOperatorConfig()): boolean {
  return Boolean(
    cfg.entityName &&
      cfg.entityAddress &&
      cfg.consumerSupportEmail &&
      cfg.grievanceOfficerName &&
      cfg.grievanceEmail &&
      cfg.privacyContactEmail,
  )
}

/** Public-safe projection for GET /api/legal/config — no server-only secrets. */
export function publicLegalConfig() {
  const cfg = legalOperatorConfig()
  return {
    termsVersion: cfg.termsVersion,
    privacyVersion: cfg.privacyVersion,
    versionsAreDraft: legalVersionsAreDraft(),
    dates: {
      terms: {
        lastUpdated: cfg.termsUpdatedAt ?? versionDate(cfg.termsVersion),
        effectiveDate: cfg.termsEffectiveDate,
      },
      privacy: {
        lastUpdated: cfg.privacyUpdatedAt ?? versionDate(cfg.privacyVersion),
        effectiveDate: cfg.privacyEffectiveDate,
      },
    },
    operator: {
      entityName: cfg.entityName || null,
      entityAddress: cfg.entityAddress || null,
      consumerSupport: {
        email: cfg.consumerSupportEmail || null,
        phone: cfg.consumerSupportPhone || null,
      },
      grievanceOfficer: {
        name: cfg.grievanceOfficerName || null,
        email: cfg.grievanceEmail || null,
        phone: cfg.grievancePhone || null,
      },
      privacyContactEmail: cfg.privacyContactEmail || null,
    },
    configured: legalContactConfigured(cfg),
  }
}
