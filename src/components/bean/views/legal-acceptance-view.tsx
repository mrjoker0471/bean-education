'use client'

// ─── Legal re-acceptance screen (existing users, material version change) ────
// Shown when the server reports `legal.reacceptanceRequired`. Rules honoured:
//   • Re-acceptance is a deliberate action — a mere sign-in never counts.
//   • Access to logout, account export, account deletion and grievance/privacy
//     requests is PRESERVED (all live in Settings and the policy pages, which
//     stay reachable while this screen replaces other views).
//   • The server validates the versions — the screen sends the server-provided
//     current versions only after the user ticks the boxes.

import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Loader2, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'

export function LegalReacceptanceView() {
  const legalStatus = useAppStore(s => s.legalStatus)
  const refreshAuth = useAppStore(s => s.refreshAuth)
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cfg, setCfg] = useState<{ termsVersion: string; privacyVersion: string } | null>(null)

  useEffect(() => {
    void api.legalConfig().then(c => setCfg({ termsVersion: c.termsVersion, privacyVersion: c.privacyVersion })).catch(() => undefined)
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !cfg) return
    setError(null)
    if (!terms || !privacy) {
      setError('Please review both documents to continue.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptedTermsVersion: cfg.termsVersion, privacyNoticeVersion: cfg.privacyVersion }),
        credentials: 'same-origin',
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const message = data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : 'Could not record your acceptance — please try again.'
        throw new Error(message)
      }
      await refreshAuth()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const accept = (v: boolean) => {
    setTerms(v === true)
    setPrivacy(v === true)
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-2xl text-foreground">Our legal documents have changed</CardTitle>
          <CardDescription className="text-muted-foreground">
            BEAN&apos;s Terms and Conditions and Privacy Policy have been updated
            {cfg ? <> to version{cfg.termsVersion === cfg.privacyVersion ? '' : 's'}{' '}
              <span className="text-foreground">{cfg.termsVersion}</span>
              {cfg.termsVersion !== cfg.privacyVersion ? <> / <span className="text-foreground">{cfg.privacyVersion}</span></> : null}
            </> : null}
            . Please review them and accept the current versions to continue using your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start gap-2">
              <Checkbox id="bean-reaccept-terms" checked={terms} onCheckedChange={v => setTerms(v === true)} className="mt-0.5" />
              <Label htmlFor="bean-reaccept-terms" className="text-xs font-normal leading-relaxed text-muted-foreground">
                I have read and accept the updated{' '}
                <a href="#/terms" className="text-gold underline underline-offset-2">Terms and Conditions</a>
                {cfg ? <> (version {cfg.termsVersion})</> : null}.
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="bean-reaccept-privacy" checked={privacy} onCheckedChange={v => setPrivacy(v === true)} className="mt-0.5" />
              <Label htmlFor="bean-reaccept-privacy" className="text-xs font-normal leading-relaxed text-muted-foreground">
                I have read the updated{' '}
                <a href="#/privacy" className="text-gold underline underline-offset-2">Privacy Policy</a>
                {cfg ? <> (version {cfg.privacyVersion})</> : null}.
              </Label>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={terms && privacy} onCheckedChange={accept} aria-label="Accept both documents" />
              Accept both documents
            </label>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !cfg}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Continue
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-border bg-elevated/40 p-3">
            <p className="text-xs font-medium text-foreground">Always available — you decide later:</p>
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
              <li><a href="#/settings" className="text-gold underline underline-offset-2">Settings</a> — export your data, delete your account, or sign out</li>
              <li><a href="#/settings" className="text-gold underline underline-offset-2">Privacy request</a> — raise a confidential access/erasure/grievance request</li>
              <li><a href="#/terms" className="text-gold underline underline-offset-2">Terms</a> · <a href="#/privacy" className="text-gold underline underline-offset-2">Privacy Policy</a> · <a href="#/trust-policy" className="text-gold underline underline-offset-2">Trust &amp; Safety</a></li>
            </ul>
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
            Accepting is a deliberate action — signing in never implies acceptance of a new version.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
