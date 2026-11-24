'use client'

// ─── Student / Teacher / Institution-first authentication (public experience +
// institution-access milestones) ───────────────────────────────────────────────
// Flow: 1) "How would you like to use BEAN?" (Student | Teacher | Institution),
// 2) Sign in / Create account / Continue with Google, with a clear way to
// change the audience without losing entered information.
//
// CRITICAL identity rule — the audience choice is an onboarding and navigation
// intent ONLY:
//   • Every registration creates a STUDENT account (server-enforced; roles
//     cannot be set from the client and Google cannot grant teacher/admin).
//   • Teacher capability = an approved TeacherProfile from the existing
//     application workflow — never this choice.
//   • Institution capability = real OrganizationMembership from the existing
//     organization system — this choice registers nothing, joins nothing and
//     approves nothing by itself.
//   • One account can be used for learning, teaching and institutions.
//
// Google sign-in uses the real server-side OAuth/OIDC flow (PKCE S256, state,
// nonce, JWKS-verified ID tokens). Without credentials the button is disabled
// with an honest message — it never fakes a login.
//
// Legal acceptance: signup requires the CURRENT Terms version, the CURRENT
// Privacy Notice acknowledgement and an honest age declaration. Versions are
// validated server-side; optional consents are purpose-specific and none are
// preselected (BEAN currently offers none).

import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, GraduationCap, Building2, LogIn, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { api } from '@/lib/api'
import type { AuthedStudent, LegalConfigDTO } from '@/lib/types'
import { SIGNUP_INTENTS } from '@/lib/teacher-intent'

type Audience = 'STUDENT' | 'TEACHER' | 'INSTITUTION'
type Panel = 'audience' | 'signin' | 'signup' | 'link' | 'google-signup'

interface AuthViewProps {
  /** Called once the server confirms sign-in/up (session cookie already set).
   *  `mode` routes next (onboarding vs dashboard); `intent` is the navigation
   *  audience picked on the first step (teacher routing). */
  onAuthed?: (student: AuthedStudent, mode: 'signin' | 'signup', intent?: Audience) => void
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
const INTENT_KEY = 'bean_signup_intent'

const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled — nothing was signed in.',
  invalid_state: 'We could not verify that this Google sign-in was started by you. Please try again.',
  expired: 'The Google sign-in attempt expired. Please try again.',
  invalid_nonce: 'We could not verify this Google sign-in (nonce mismatch). Please try again.',
  invalid_issuer: 'We could not verify this Google sign-in (unexpected issuer). Please try again.',
  invalid_audience: 'We could not verify this Google sign-in (audience mismatch). Please try again.',
  invalid_signature: 'We could not verify the Google identity (signature check failed). Please try again.',
  id_token_expired: 'The Google identity token had expired. Please try again.',
  email_unverified: 'Your Google email is not verified, so BEAN cannot use it to sign you in.',
  token_exchange_failed: 'Google sign-in could not be completed. Please try again.',
  temporarily_unavailable: 'Google sign-in is temporarily unavailable. Please try again shortly.',
  rate_limited: 'Too many Google sign-in attempts — please wait a moment and try again.',
  not_configured: 'Google sign-in is not configured yet.',
  provider_error: 'Google reported a problem with the sign-in attempt. Please try again.',
  verification_failed: 'We could not verify the Google identity. Please try again.',
  unexpected: 'Something went wrong during Google sign-in — please try again.',
}

function errorFrom(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error?: unknown }).error
    if (typeof message === 'string' && message) return message
  }
  return null
}

function codeFrom(data: unknown): string | null {
  if (data && typeof data === 'object' && 'code' in data) {
    const code = (data as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return null
}

function studentFrom(data: unknown): AuthedStudent | null {
  if (!data || typeof data !== 'object' || !('student' in data)) return null
  const s = (data as { student?: unknown }).student
  if (!s || typeof s !== 'object') return null
  const candidate = s as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.email !== 'string') return null
  return {
    id: candidate.id,
    email: candidate.email,
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName : null,
    learningLevel: typeof candidate.learningLevel === 'string' ? candidate.learningLevel : null,
    role: typeof candidate.role === 'string' ? candidate.role : 'STUDENT',
    onboardedAt: typeof candidate.onboardedAt === 'string' ? candidate.onboardedAt : null,
    signupIntent: typeof candidate.signupIntent === 'string' ? candidate.signupIntent : null,
  }
}

async function postAuth(endpoint: string, body: Record<string, unknown>): Promise<AuthedStudent> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(errorFrom(data) ?? 'Something went wrong on our side — please try again.')
  }
  const student = studentFrom(data)
  if (!student) throw new Error('The server returned an unexpected response — please try again.')
  return student
}

/** Legal acceptance block shared by password signup and Google signup. */
function LegalAcceptanceFields(props: {
  legalCfg: LegalConfigDTO | null
  acceptTerms: boolean
  ackPrivacy: boolean
  ageBand: 'ADULT_18_PLUS' | 'UNDER_18' | null
  onAcceptTerms: (v: boolean) => void
  onAckPrivacy: (v: boolean) => void
  onAgeBand: (v: 'ADULT_18_PLUS' | 'UNDER_18' | null) => void
}) {
  const draft = props.legalCfg?.versionsAreDraft ?? true
  return (
    <div className="space-y-3 rounded-lg border border-border bg-elevated/40 p-3">
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-foreground">Age declaration</legend>
        <p className="text-xs leading-relaxed text-muted-foreground">
          BEAN supports school-level learners. To keep children&apos;s data safe, accounts for users under 18 need
          guardian verification that is not available yet.
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name="bean-age"
              checked={props.ageBand === 'ADULT_18_PLUS'}
              onChange={() => props.onAgeBand('ADULT_18_PLUS')}
              disabled={false}
              aria-label="I am 18 or older"
            />
            I am 18 or older
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              name="bean-age"
              checked={props.ageBand === 'UNDER_18'}
              onChange={() => props.onAgeBand('UNDER_18')}
              aria-label="I am under 18"
            />
            I am under 18
          </label>
        </div>
        {props.ageBand === 'UNDER_18' && (
          <p className="rounded-md border border-gold/30 bg-gold/10 p-2 text-xs leading-relaxed text-gold" role="note">
            Guardian-verified accounts are not available yet, so we cannot create an account for you right now —
            nothing you type here is stored. You can keep using BEAN in guest mode, which keeps your session data
            on this device only.
          </p>
        )}
      </fieldset>

      <div className="flex items-start gap-2">
        <Checkbox
          id="bean-accept-terms"
          checked={props.acceptTerms}
          onCheckedChange={v => props.onAcceptTerms(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="bean-accept-terms" className="text-xs font-normal leading-relaxed text-muted-foreground">
          I have read and accept the{' '}
          <a href="#/terms" className="text-gold underline underline-offset-2" target="_blank" rel="noreferrer">
            Terms and Conditions
          </a>
          {props.legalCfg ? <> (version {props.legalCfg.termsVersion}{draft ? ', draft' : ''})</> : null}.
        </Label>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="bean-ack-privacy"
          checked={props.ackPrivacy}
          onCheckedChange={v => props.onAckPrivacy(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="bean-ack-privacy" className="text-xs font-normal leading-relaxed text-muted-foreground">
          I have read the{' '}
          <a href="#/privacy" className="text-gold underline underline-offset-2" target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          {props.legalCfg ? <> (version {props.legalCfg.privacyVersion}{draft ? ', draft' : ''})</> : null} and I
          understand how my information is used.
        </Label>
      </div>
    </div>
  )
}

export function AuthView({ onAuthed }: AuthViewProps) {
  const [panel, setPanel] = useState<Panel>('audience')
  const [audience, setAudience] = useState<Audience>('STUDENT')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Google configuration + legal versions (fetched once).
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null)
  const [legalCfg, setLegalCfg] = useState<LegalConfigDTO | null>(null)

  // Legal acceptance state.
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [ackPrivacy, setAckPrivacy] = useState(false)
  const [ageBand, setAgeBand] = useState<'ADULT_18_PLUS' | 'UNDER_18' | null>(null)

  // Google pending flows (arrive via redirect markers in the hash query).
  const [googleLinkPending, setGoogleLinkPending] = useState<string | null>(null)
  const [googleSignupPending, setGoogleSignupPending] = useState<string | null>(null)
  const [googleEmail, setGoogleEmail] = useState('')

  useEffect(() => {
    // Restore a previously chosen audience so navigation intent survives
    // the Google redirect round-trip (and revisits within this tab).
    try {
      const saved = sessionStorage.getItem(INTENT_KEY)
      if ((SIGNUP_INTENTS as readonly string[]).includes(saved ?? '')) setAudience(saved as Audience)
    } catch { /* no sessionStorage — default STUDENT */ }

    const hash = window.location.hash
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    const params = new URLSearchParams(query)
    const linkId = params.get('google_link')
    const signupId = params.get('google_signup')
    const done = params.get('google_done')
    const errCode = params.get('google_error')

    if (linkId) {
      setGoogleLinkPending(linkId)
      setGoogleEmail(params.get('google_email') ?? '')
      setPanel('link')
    } else if (signupId) {
      setGoogleSignupPending(signupId)
      setGoogleEmail(params.get('google_email') ?? '')
      setPanel('google-signup')
    } else if (done) {
      // OAuth sign-in completed server-side — confirm and route. The audience
      // chosen before the redirect is restored from sessionStorage and passed
      // through as the navigation intent so a Google sign-in never silently
      // loses the Teacher/Institution selection (the account's recorded
      // signupIntent is NOT overwritten — resolvePostAuthRoute only navigates).
      setBusy(true)
      let intentAfterRedirect: Audience | null = null
      try {
        const saved = sessionStorage.getItem(INTENT_KEY)
        if ((SIGNUP_INTENTS as readonly string[]).includes(saved ?? '')) intentAfterRedirect = saved as Audience
      } catch { /* no sessionStorage — fall back to the account's intent */ }
      api
        .authMe()
        .then(({ student }) => {
          if (student) {
            onAuthed?.(
              {
                id: student.id,
                email: student.email,
                displayName: student.displayName,
                learningLevel: student.learningLevel,
                role: student.role,
                onboardedAt: student.onboardedAt,
                signupIntent: student.signupIntent,
              },
              'signin',
              intentAfterRedirect ?? undefined,
            )
          } else {
            setError('Google sign-in completed, but your session could not be confirmed — please try again.')
            setPanel('audience')
          }
        })
        .catch(() => {
          setError('Your session could not be confirmed — please try again.')
          setPanel('audience')
        })
        .finally(() => setBusy(false))
    } else if (errCode) {
      setError(GOOGLE_ERRORS[errCode] ?? 'Google sign-in could not be completed — please try again.')
      setPanel('audience')
    } else {
      setPanel('audience')
    }

    void api.googleStatus().then(s => setGoogleConfigured(s.configured)).catch(() => setGoogleConfigured(false))
    void api.legalConfig().then(setLegalCfg).catch(() => setLegalCfg(null))
  }, [])

  const chooseAudience = (a: Audience) => {
    setAudience(a)
    try {
      sessionStorage.setItem(INTENT_KEY, a)
    } catch { /* non-fatal */ }
    setPanel('signup')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)

    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    // The validated age declaration is captured by the signup guards below —
    // the payload carries exactly what the user declared, never a hardcoded
    // value (and the server re-validates + refuses UNDER_18 fail-safe).
    // SIGN-IN requires NO fresh declaration: the account already carries its
    // server-verified age band, and the server-side under-18 guard is
    // untouched. (Regression fix: the declaration gate previously blocked
    // every password sign-in because the sign-in panel renders no radios.)
    let declaredAge: 'ADULT_18_PLUS' | null = null
    if (panel === 'signup') {
      if (password.length < 8) {
        setError('Your password must be at least 8 characters.')
        return
      }
      if (!acceptTerms || !ackPrivacy) {
        setError('Please review and accept the Terms and Privacy Notice to create an account.')
        return
      }
      if (!ageBand) {
        setError('Please complete the age declaration.')
        return
      }
      if (ageBand === 'UNDER_18') {
        // Honest fail-safe: nothing is submitted, nothing is stored.
        setError('Guardian-verified accounts are not available yet, so an account cannot be created right now. You can keep using guest mode.')
        return
      }
      declaredAge = ageBand
      if (!declaredAge) {
        setError('Please complete the age declaration.')
        return
      }
    }

    setBusy(true)
    try {
      if (panel === 'signin') {
        const { student } = await api.authLogin({ email: normalizedEmail, password })
        onAuthed?.(
          {
            id: student.id,
            email: student.email,
            displayName: student.displayName,
            learningLevel: student.learningLevel,
            role: student.role,
            onboardedAt: student.onboardedAt,
            signupIntent: student.signupIntent,
          },
          'signin',
          audience,
        )
        return
      }

      // Honest guard: the signup gates above guarantee a declaration, but the
      // compiler cannot narrow it across branches — fail closed, never default.
      if (declaredAge === null) {
        setError('Please complete the age declaration.')
        return
      }
      const { student } = await api.authRegister({
        email: normalizedEmail,
        password,
        displayName: displayName.trim() || undefined,
        acceptedTermsVersion: legalCfg?.termsVersion ?? '',
        privacyNoticeVersion: legalCfg?.privacyVersion ?? '',
        // Honest passthrough: declaredAge is the declaration the user actually
        // made (validated above) — never a hardcoded value.
        ageDeclaration: declaredAge,
        intent: audience,
      })
      onAuthed?.(
        {
          id: student.id,
          email: student.email,
          displayName: student.displayName,
          learningLevel: student.learningLevel,
          role: student.role,
          onboardedAt: student.onboardedAt,
          signupIntent: student.signupIntent,
        },
        'signup',
        audience,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const submitLink = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !googleLinkPending) return
    setError(null)
    setBusy(true)
    try {
      const student = await postAuth('/api/auth/google/link', {
        pendingId: googleLinkPending,
        password: password || undefined,
      })
      onAuthed?.(
        {
          id: student.id,
          email: student.email,
          displayName: student.displayName,
          learningLevel: student.learningLevel,
          role: student.role,
          onboardedAt: student.onboardedAt,
          signupIntent: student.signupIntent,
        },
        'signin',
        audience,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const submitGoogleSignup = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !googleSignupPending) return
    setError(null)
    if (!acceptTerms || !ackPrivacy) {
      setError('Please review and accept the Terms and Privacy Notice to create an account.')
      return
    }
    if (!ageBand) {
      setError('Please complete the age declaration.')
      return
    }
    if (ageBand === 'UNDER_18') {
      setError('Guardian-verified accounts are not available yet, so an account cannot be created right now. You can keep using guest mode.')
      return
    }
    setBusy(true)
    try {
      const student = await postAuth('/api/auth/google/complete', {
        pendingId: googleSignupPending,
        acceptedTermsVersion: legalCfg?.termsVersion ?? '',
        privacyNoticeVersion: legalCfg?.privacyVersion ?? '',
        // Honest passthrough (see submit()): the declaration the user made.
        ageDeclaration: ageBand,
        intent: audience,
      })
      onAuthed?.(
        {
          id: student.id,
          email: student.email,
          displayName: student.displayName,
          learningLevel: student.learningLevel,
          role: student.role,
          onboardedAt: student.onboardedAt,
          signupIntent: student.signupIntent,
        },
        'signup',
        audience,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const startGoogle = () => {
    try {
      sessionStorage.setItem(INTENT_KEY, audience)
    } catch { /* non-fatal */ }
    window.location.assign('/api/auth/google/start')
  }

  const audienceTitle =
    audience === 'TEACHER' ? 'Teach on BEAN' : audience === 'INSTITUTION' ? 'Institutions on BEAN' : 'Learn on BEAN'
  const audienceNoun = audience === 'TEACHER' ? 'a teacher' : audience === 'INSTITUTION' ? 'an institution member' : 'a student'
  const audienceBlurb =
    audience === 'TEACHER'
      ? 'One BEAN account for teaching: apply once, and after administrator approval publish classes, manage students and grow through BEAN Teach.'
      : audience === 'INSTITUTION'
        ? 'One BEAN account for your organisation: register a new institution or join an existing one through an invitation. Verification and member permissions are separate, administrator-controlled steps.'
        : 'Learn, prepare for examinations, use Riishe AI, organise study materials and track your learning progress.'

  // ─── Step 1: audience choice ────────────────────────────────────────────────
  if (panel === 'audience') {
    return (
      <Card className="w-full glass rounded-2xl border border-hairline">
        <CardHeader className="text-left">
          <CardTitle className="font-display text-2xl text-foreground">How would you like to use BEAN?</CardTitle>
          <CardDescription className="text-muted-foreground">
            Pick the experience you want first — one BEAN account can learn, teach and manage an institution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <button
            type="button"
            onClick={() => chooseAudience('STUDENT')}
            aria-pressed={audience === 'STUDENT'}
            className={`w-full rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:bg-gold/[0.06] focus-visible:outline-2 focus-visible:outline-gold ${audience === 'STUDENT' ? 'border-gold/40 bg-gold/[0.04]' : 'border-hairline bg-white/[0.03]'}`}
            aria-describedby="bean-audience-student-desc"
          >
            <div className="flex items-center gap-2 text-foreground">
              <GraduationCap className="h-5 w-5 shrink-0 text-gold" aria-hidden />
              <span className="font-display text-lg">Student</span>
            </div>
            <p id="bean-audience-student-desc" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Learn, prepare for examinations, use Riishe AI, organise study materials and track your learning
              progress.
            </p>
          </button>

          <button
            type="button"
            onClick={() => chooseAudience('TEACHER')}
            aria-pressed={audience === 'TEACHER'}
            className={`w-full rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:bg-gold/[0.06] focus-visible:outline-2 focus-visible:outline-gold ${audience === 'TEACHER' ? 'border-gold/40 bg-gold/[0.04]' : 'border-hairline bg-white/[0.03]'}`}
            aria-describedby="bean-audience-teacher-desc"
          >
            <div className="flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5 shrink-0 text-gold" aria-hidden />
              <span className="font-display text-lg">Teacher</span>
            </div>
            <p id="bean-audience-teacher-desc" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Apply to teach, publish classes after approval, manage students and grow through BEAN Teach.
            </p>
          </button>

          <button
            type="button"
            onClick={() => chooseAudience('INSTITUTION')}
            aria-pressed={audience === 'INSTITUTION'}
            className={`w-full rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:bg-gold/[0.06] focus-visible:outline-2 focus-visible:outline-gold ${audience === 'INSTITUTION' ? 'border-gold/40 bg-gold/[0.04]' : 'border-hairline bg-white/[0.03]'}`}
            aria-describedby="bean-audience-institution-desc"
          >
            <div className="flex items-center gap-2 text-foreground">
              <Building2 className="h-5 w-5 shrink-0 text-gold" aria-hidden />
              <span className="font-display text-lg">Institution</span>
            </div>
            <p id="bean-audience-institution-desc" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Register your school, college, coaching centre or organisation, manage members and classes, or join an
              existing institution through an invitation.
            </p>
          </button>

          <p className="flex items-start gap-2 pt-1 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
            Choosing “Teacher” does not grant teaching rights — every teacher completes an application and an
            authorised review. Choosing “Institution” does not verify or approve an organisation — registration,
            verification and membership are separate administrator-controlled steps. You can keep using BEAN without
            an account.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ─── Google account linking (proof of ownership) ────────────────────────────
  if (panel === 'link') {
    return (
      <Card className="w-full glass rounded-2xl border border-hairline">
        <CardHeader className="text-left">
          <CardTitle className="font-display text-2xl text-foreground">Link your Google account</CardTitle>
          <CardDescription className="text-muted-foreground">
            {googleEmail ? <>A Google account for <span className="text-foreground">{googleEmail}</span> wants to link to this BEAN account. Enter your BEAN password to prove you own it.</> : 'Enter your BEAN password to prove you own this account before linking Google.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitLink} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bean-link-password">Your BEAN password</Label>
              <Input
                id="bean-link-password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
            </div>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Link Google account
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setPanel('audience'); setError(null) }}>
              Cancel
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  // ─── Google first-time signup (same legal acceptance as normal signup) ──────
  if (panel === 'google-signup') {
    return (
      <Card className="w-full glass rounded-2xl border border-hairline">
        <CardHeader className="text-left">
          <CardTitle className="font-display text-2xl text-foreground">Complete your Google sign-up</CardTitle>
          <CardDescription className="text-muted-foreground">
            {googleEmail ? <>Create your BEAN account for <span className="text-foreground">{googleEmail}</span>.</> : 'Finish creating your BEAN account.'} Your audience choice ({audienceTitle}) is kept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitGoogleSignup} className="space-y-4">
            <LegalAcceptanceFields
              legalCfg={legalCfg}
              acceptTerms={acceptTerms}
              ackPrivacy={ackPrivacy}
              ageBand={ageBand}
              onAcceptTerms={setAcceptTerms}
              onAckPrivacy={setAckPrivacy}
              onAgeBand={setAgeBand}
            />
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Create my account
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setPanel('audience'); setError(null) }}>
              Cancel
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  // ─── Step 2: sign in / create account (+ Google) ────────────────────────────
  return (
    <Card className="w-full glass rounded-2xl border border-hairline">
      <CardHeader className="text-left">
        <CardTitle className="font-display text-2xl text-foreground">{audienceTitle}</CardTitle>
        <CardDescription className="text-muted-foreground">{audienceBlurb}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-lg border border-hairline bg-white/[0.03] px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Using BEAN as <span className="text-foreground">{audienceNoun}</span>
          </span>
          <button
            type="button"
            className="rounded text-xs text-gold underline underline-offset-2 hover:text-gold-hover"
            onClick={() => setPanel('audience')}
          >
            Change
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-lg border border-border p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${panel === 'signin' ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => { setPanel('signin'); setError(null) }}
            aria-pressed={panel === 'signin'}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${panel === 'signup' ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => { setPanel('signup'); setError(null) }}
            aria-pressed={panel === 'signup'}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {panel === 'signup' && (
            <div className="space-y-1.5">
              <Label htmlFor="bean-auth-name">
                Display name <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="bean-auth-name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={80}
                autoComplete="name"
                placeholder="How should we greet you?"
                disabled={busy}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="bean-auth-email">Email</Label>
            <Input
              id="bean-auth-email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bean-auth-password">Password</Label>
            <Input
              id="bean-auth-password"
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={panel === 'signup' ? 'new-password' : 'current-password'}
              minLength={panel === 'signup' ? 8 : undefined}
              placeholder={panel === 'signup' ? 'At least 8 characters' : 'Your password'}
              disabled={busy}
            />
          </div>

          {panel === 'signup' && (
            <LegalAcceptanceFields
              legalCfg={legalCfg}
              acceptTerms={acceptTerms}
              ackPrivacy={ackPrivacy}
              ageBand={ageBand}
              onAcceptTerms={setAcceptTerms}
              onAckPrivacy={setAckPrivacy}
              onAgeBand={setAgeBand}
            />
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy}>
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : panel === 'signin' ? (
              <LogIn className="mr-1.5 h-4 w-4" aria-hidden />
            ) : (
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            {busy ? 'Working…' : panel === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full border-gold/40 text-gold hover:bg-gold/10"
          onClick={startGoogle}
          disabled={googleConfigured === false || busy}
          aria-describedby={googleConfigured === false ? 'bean-google-status' : undefined}
        >
          {googleConfigured === null ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
          Continue with Google
        </Button>
        {googleConfigured === false && (
          <p id="bean-google-status" className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Google sign-in will be available once the owner configures the Google OAuth credentials. Email sign-in
            works right now.
          </p>
        )}

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          You can keep using BEAN without an account — signing in saves your library and progress across devices.
        </p>
      </CardContent>
    </Card>
  )
}
