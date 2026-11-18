'use client'

// Settings — account identity, privacy controls and preferences. The platform
// is device-based (guest identity): this page makes that explicit and gives
// the student real control over their data.

import { useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore, resetGuestIdentity } from '@/lib/store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Bot, Database, Download, KeyRound, Loader2, LogOut, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { LocalAiCard } from '@/components/bean/local-ai-card'

export function SettingsView() {
  const guestId = useAppStore(s => s.guestId)
  const beanSettings = useAppStore(s => s.beanSettings)
  const setBeanSettings = useAppStore(s => s.setBeanSettings)
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const authSignOut = useAppStore(s => s.authSignOut)
  const authDeleteAccount = useAppStore(s => s.authDeleteAccount)
  const claimGuestData = useAppStore(s => s.claimGuestData)

  const [deleting, setDeleting] = useState(false)
  const [busyAuth, setBusyAuth] = useState<'none' | 'signout' | 'delete' | 'claim' | 'export'>('none')

  // Session creation date — read once on first render (defensive default).
  const [createdLabel] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('bean_guest_created')
      if (raw) {
        const d = new Date(raw)
        if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
      }
      localStorage.setItem('bean_guest_created', new Date().toISOString())
    } catch { /* non-fatal */ }
    return 'this device'
  })

  const maskedId = guestId ? `${guestId.slice(0, 8)}…${guestId.slice(-4)}` : '—'

  const doDeleteAll = () => {
    if (!guestId || deleting) return
    setDeleting(true)
    api
      .deleteAccountData(guestId)
      .then(res => {
        const d = res.deleted
        toast({
          title: 'All your data has been deleted',
          description: `${d.documents} document${d.documents === 1 ? '' : 's'}, ${d.attempts} attempt${d.attempts === 1 ? '' : 's'} and ${d.chatTurns} chat message${d.chatTurns === 1 ? '' : 's'} were permanently removed.`,
        })
      })
      .catch((e: unknown) => {
        toast({ title: 'Could not delete your data', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
      })
      .finally(() => setDeleting(false))
  }

  const doResetSession = () => {
    resetGuestIdentity()
    try {
      localStorage.setItem('bean_guest_created', new Date().toISOString())
    } catch { /* non-fatal */ }
    toast({ title: 'New session started', description: 'This device now uses a fresh, empty library.' })
    navigate({ view: 'home' })
  }

  // ── Student account actions (Phase 2A) ──
  const doClaim = () => {
    if (busyAuth !== 'none') return
    setBusyAuth('claim')
    claimGuestData()
      .then(c => {
        const any = c.attempts + c.documents + c.tests + c.chatTurns
        toast(any > 0
          ? { title: 'Session data saved to your account', description: `${c.documents} document${c.documents === 1 ? '' : 's'}, ${c.attempts} attempt${c.attempts === 1 ? '' : 's'}, ${c.tests} practice set${c.tests === 1 ? '' : 's'} and ${c.chatTurns} chat message${c.chatTurns === 1 ? '' : 's'} now belong to your account.` }
          : { title: 'Nothing to save', description: 'This session has no unclaimed data — everything already belongs to your account.' })
      })
      .catch((e: unknown) => toast({ title: 'Could not save session data', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' }))
      .finally(() => setBusyAuth('none'))
  }

  const doExport = () => {
    if (busyAuth !== 'none') return
    setBusyAuth('export')
    api.exportAccount()
      .then(() => toast({ title: 'Export downloaded', description: 'A JSON copy of your account data was saved to your device.' }))
      .catch((e: unknown) => toast({ title: 'Could not export data', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' }))
      .finally(() => setBusyAuth('none'))
  }

  const doSignOut = () => {
    if (busyAuth !== 'none') return
    setBusyAuth('signout')
    authSignOut()
      .then(() => toast({ title: 'Signed out', description: 'This device is back in guest mode — nothing was deleted.' }))
      .catch((e: unknown) => toast({ title: 'Sign out failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' }))
      .finally(() => setBusyAuth('none'))
  }

  const doDeleteAccount = () => {
    if (busyAuth !== 'none') return
    setBusyAuth('delete')
    authDeleteAccount()
      .then(() => toast({ title: 'Account deleted', description: 'Your account and all its data were permanently removed. This device continues in guest mode.' }))
      .catch((e: unknown) => toast({ title: 'Could not delete the account', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' }))
      .finally(() => setBusyAuth('none'))
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Account · privacy · preferences</p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">Settings</h1>
      </header>

      <div className="mt-8 space-y-6">
        {/* Account */}
        <section aria-label="Account" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-gold" aria-hidden /> Account
          </h2>
          {authedStudent ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Signed in as <span className="text-foreground">{authedStudent.displayName || authedStudent.email}</span>.
                Your library and progress follow your account on every device where you sign in.
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-elevated px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Email</dt>
                  <dd className="mt-1 text-sm text-foreground">{authedStudent.email}</dd>
                </div>
                <div className="rounded-lg border border-border bg-elevated px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">This device session</dt>
                  <dd className="mt-1 font-mono text-sm text-foreground">{maskedId}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={doClaim} disabled={busyAuth !== 'none'}>
                  {busyAuth === 'claim' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Save this session&apos;s data to my account
                </Button>
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={doExport} disabled={busyAuth !== 'none'}>
                  {busyAuth === 'export' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Export my data (JSON)
                </Button>
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={doSignOut} disabled={busyAuth !== 'none'}>
                  {busyAuth === 'signout' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Sign out
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={busyAuth !== 'none'}>
                      {busyAuth === 'delete' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                      Delete account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-display">Delete your account?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Permanently removes your account, profile, goals and every document, practice set, attempt and
                        chat owned by it. This cannot be undone and no export is kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep my account</AlertDialogCancel>
                      <AlertDialogAction className="bg-destructive text-primary-foreground hover:bg-destructive/90" onClick={doDeleteAccount}>
                        Delete everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {authChecked
                  ? 'BEAN works fully without an account — this device session owns everything you do. Create a free account to keep your library and progress across devices.'
                  : 'Checking your session…'}
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-elevated px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Session ID</dt>
                  <dd className="mt-1 font-mono text-sm text-foreground">{maskedId}</dd>
                </div>
                <div className="rounded-lg border border-border bg-elevated px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Active since</dt>
                  <dd className="mt-1 text-sm text-foreground">{createdLabel}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
                  <UserRound className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Sign in or create a free account
                </Button>
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={doResetSession}>
                  Start a fresh session on this device
                </Button>
              </div>
            </>
          )}
        </section>

        {/* Privacy */}
        <section aria-label="Privacy" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-gold" aria-hidden /> Privacy
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li className="flex items-start gap-2">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
              Your uploaded PDFs are stored on the server only for your own analysis and are never shared or published.
            </li>
            <li className="flex items-start gap-2">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
              Analyses, practice sets, attempts and chats are scoped to your session and cannot be read by anyone else.
            </li>
            <li className="flex items-start gap-2">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
              Document text is processed by the configured AI provider as inert study data — never as instructions.
            </li>
          </ul>

          <Separator className="my-4" />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Delete everything from this session</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Permanently removes every uploaded file, analysis, practice set, attempt, explanation and chat
                message. This cannot be undone.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="shrink-0" disabled={deleting}>
                  {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Delete my data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-display">Delete all session data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every upload, analysis, practice set, attempt and conversation for this session will be
                    permanently deleted from the server. Your files on this device are not touched.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my data</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-primary-foreground hover:bg-destructive/90" onClick={doDeleteAll}>
                    Delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>

        {/* Preferences */}
        <section aria-label="Preferences" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Bot className="h-4 w-4 text-gold" aria-hidden /> AI tutor preferences
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            These apply to BEAN Intelligence and the Ask Riishe chat. Response style changes presentation and depth
            only — never the sources. Riishe&apos;s practice explanations always follow your documents.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Explanation style</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Explanation style">
                {(['exam-focused', 'simple', 'detailed'] as const).map(style => (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={beanSettings.style === style}
                    onClick={() => setBeanSettings({ style })}
                    className={cn(
                      'min-h-9 rounded-lg border px-3.5 py-1.5 text-sm capitalize transition-colors',
                      beanSettings.style === style
                        ? 'border-gold/60 bg-gold/15 text-gold'
                        : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                    )}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="show-source-context" className="text-sm font-medium text-foreground">
                  Show what context was used
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Shows the document, page range and excerpt behind each answer — or “No uploaded source used.”
                </p>
              </div>
              <Switch
                id="show-source-context"
                checked={beanSettings.showSourceContext}
                onCheckedChange={v => setBeanSettings({ showSourceContext: v })}
                aria-label="Toggle source context"
              />
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-border bg-elevated px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Badge variant="outline" className="mr-2 border-gold/40 text-gold">About Riishe</Badge>
              Riishe never exposes answers before you submit, scores every attempt on the server, and cites the exact
              page in your documents for every fact. Every chat answer is labelled document-grounded, mixed or general
              knowledge — general-knowledge answers are never presented as verified against your material. If the AI
              provider is unavailable, the app says so plainly — nothing is simulated.
            </p>
          </div>
        </section>

        {/* On-device AI (Phase 2A foundation) */}
        <LocalAiCard />
      </div>
    </div>
  )
}
