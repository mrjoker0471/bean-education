'use client'

// ─── Sign in / create account (Phase 2A identity) ─────────────────────────────
// Self-contained panel: talks to /api/auth/* directly with same-origin
// credentials (deliberately NOT via lib/api). Guest data stays intact — the
// app shell claims it separately via POST /api/auth/claim-guest after this
// component reports the signed-in student.

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, LogIn, ShieldCheck, UserPlus } from 'lucide-react'

export interface AuthedStudent {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  role: string
  onboardedAt: string | null
}

/** Exact student DTO returned by the auth endpoints on success. */
interface StudentDTO {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  role: string
  onboardedAt: string | null
}

interface AuthViewProps {
  /** Called once the server confirms sign-in/up (session cookie already set).
   *  `mode` lets the shell decide where to route next (onboarding vs dashboard). */
  onAuthed?: (student: AuthedStudent, mode: 'signin' | 'signup') => void
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

function errorFrom(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error?: unknown }).error
    if (typeof message === 'string' && message) return message
  }
  return null
}

function studentFrom(data: unknown): StudentDTO | null {
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
  }
}

async function postAuth(endpoint: 'login' | 'register', body: Record<string, unknown>): Promise<StudentDTO> {
  const res = await fetch(`/api/auth/${endpoint}`, {
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

export function AuthView({ onAuthed }: AuthViewProps) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)

    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    if (tab === 'signup' && password.length < 8) {
      setError('Your password must be at least 8 characters.')
      return
    }

    setBusy(true)
    try {
      const body =
        tab === 'signin'
          ? { email: normalizedEmail, password }
          : { email: normalizedEmail, password, displayName: displayName.trim() || undefined }
      const student = await postAuth(tab === 'signin' ? 'login' : 'register', body)
      onAuthed?.(
        {
          id: student.id,
          email: student.email,
          displayName: student.displayName,
          learningLevel: student.learningLevel,
          role: student.role,
          onboardedAt: student.onboardedAt,
        },
        tab,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md border-border bg-card">
      <CardHeader>
        <CardTitle className="font-display text-2xl text-foreground">Your BEAN account</CardTitle>
        <CardDescription className="text-muted-foreground">
          Keep your library, attempts and Riishe practice sets with you — across devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={tab}
          onValueChange={v => {
            setTab(v === 'signup' ? 'signup' : 'signin')
            setError(null)
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <form onSubmit={submit} className="mt-4 space-y-4">
            {tab === 'signup' && (
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
                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                minLength={tab === 'signup' ? 8 : undefined}
                placeholder={tab === 'signup' ? 'At least 8 characters' : 'Your password'}
                disabled={busy}
              />
            </div>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : tab === 'signin' ? (
                <LogIn className="mr-1.5 h-4 w-4" aria-hidden />
              ) : (
                <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
              )}
              {busy ? 'Working…' : tab === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </Tabs>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          You can keep using BEAN without an account — sign in saves your library and progress across devices.
        </p>
      </CardContent>
    </Card>
  )
}
