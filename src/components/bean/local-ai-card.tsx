'use client'

// ─── On-device AI (browser-local inference) — settings card ───────────────────
// Reconstructed for Phase 2B: this component was referenced by the Settings
// view in the Phase 2A merge but its file was never committed, which broke the
// production build. It presents the Phase 2A ai-local FOUNDATION honestly:
//   • detectLocalAi() probe → what THIS browser can do (nothing is downloaded)
//   • The consent model: a model only ever reaches a device after the user of
//     THAT device deliberately opts in — the app never pre-downloads anything.
//   • The optional runtime is not shipped in this build, so the "try enabling"
//     path surfaces the adapter's own honest failure message instead of
//     pretending on-device inference works.
// Server-side BEAN/Riishe chat remains the default path; this card is additive.

import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { createLocalAdapter, detectLocalAi, type LocalAiCapabilities } from '@/lib/ai-local'
import { cn } from '@/lib/utils'
import { Cpu, Info, Loader2, ShieldCheck } from 'lucide-react'

type ProbeState =
  | { phase: 'probing' }
  | { phase: 'done'; caps: LocalAiCapabilities }

type EnableState =
  | { phase: 'idle' }
  | { phase: 'working'; detail: string }
  | { phase: 'failed'; message: string }

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function LocalAiCard() {
  const [probe, setProbe] = useState<ProbeState>({ phase: 'probing' })
  const [enable, setEnable] = useState<EnableState>({ phase: 'idle' })
  const adapterRef = useRef<{ dispose: () => Promise<void> } | null>(null)

  useEffect(() => {
    let cancelled = false
    detectLocalAi()
      .then(caps => {
        if (!cancelled) setProbe({ phase: 'done', caps })
      })
      .catch(() => {
        if (!cancelled) {
          setProbe({
            phase: 'done',
            caps: {
              webgpu: false,
              wasm: false,
              recommendation: 'UNAVAILABLE',
              detail: 'Capability detection could not run in this browser.',
            },
          })
        }
      })
    return () => {
      cancelled = true
      void adapterRef.current?.dispose()
      adapterRef.current = null
    }
  }, [])

  const caps = probe.phase === 'done' ? probe.caps : null

  const tryEnable = () => {
    if (!caps || enable.phase === 'working') return
    setEnable({ phase: 'working', detail: 'Preparing the optional on-device runtime…' })
    try {
      // Consent gate: this runs ONLY from this explicit button press. When the
      // optional runtime is absent (this build), init() rejects with the
      // adapter's honest, actionable message — nothing is downloaded.
      const adapter = createLocalAdapter(caps.recommendation === 'WEBGPU' ? 'WEBGPU' : 'WASM')
      adapterRef.current = adapter
      adapter
        .init(detail => setEnable({ phase: 'working', detail }))
        .then(() => setEnable({ phase: 'idle' }))
        .catch((err: unknown) => {
          setEnable({ phase: 'failed', message: err instanceof Error ? err.message : 'On-device AI could not be enabled.' })
          void adapter.dispose()
          adapterRef.current = null
        })
    } catch (err) {
      setEnable({ phase: 'failed', message: err instanceof Error ? err.message : 'On-device AI could not be enabled.' })
    }
  }

  const recommendationLabel =
    caps?.recommendation === 'WEBGPU'
      ? 'WebGPU capable'
      : caps?.recommendation === 'WASM'
        ? 'WebAssembly fallback'
        : caps
          ? 'Not available here'
          : 'Checking…'

  return (
    <section aria-label="On-device AI" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
        <Cpu className="h-4 w-4 text-gold" aria-hidden /> On-device AI <span className="text-xs font-normal text-muted-foreground">(foundation)</span>
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        BEAN can one day run small AI models directly in this browser — prompts and documents would stay on your
        device. This is a foundation milestone: capability detection and the adapter interface only. Nothing is
        downloaded now, and the server-side Riishe/BEAN chat remains the default path.
      </p>

      {probe.phase === 'probing' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden /> Checking this browser&apos;s capabilities…
        </p>
      )}

      {caps && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-gold/40 text-gold">{recommendationLabel}</Badge>
            {caps.webgpu && <Badge variant="outline" className="border-border text-muted-foreground">WebGPU</Badge>}
            {caps.wasm && <Badge variant="outline" className="border-border text-muted-foreground">WebAssembly</Badge>}
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{caps.detail}</p>

          <dl className="mt-3 divide-y divide-border/60 rounded-lg border border-border bg-elevated px-4 py-1">
            <FactRow label="GPU adapter" value={caps.adapterName ?? (caps.webgpu ? 'Available (unnamed)' : 'Not detected')} />
            <FactRow label="WebAssembly" value={caps.wasm ? 'Working' : 'Unavailable'} />
            <FactRow label="Device memory" value={caps.memoryGB ? `~${caps.memoryGB} GB` : 'Not reported'} />
            <FactRow label="CPU cores" value={caps.cores ? String(caps.cores) : 'Not reported'} />
            <FactRow label="Storage quota" value={caps.storageQuotaGB ? `~${caps.storageQuotaGB} GB` : 'Not reported'} />
          </dl>

          <Separator className="my-4" />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
              Any model download is always explicit, per-device and consent-gated. This build ships no optional
              runtime yet — attempting to enable it will report that honestly.
            </p>
            <Button
              variant="outline"
              size="sm"
              className={cn('shrink-0 border-border text-muted-foreground hover:bg-elevated')}
              onClick={tryEnable}
              disabled={enable.phase === 'working' || caps.recommendation === 'UNAVAILABLE'}
            >
              {enable.phase === 'working' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Info className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Try enabling on-device AI
            </Button>
          </div>

          {enable.phase === 'working' && (
            <p className="mt-3 rounded-lg border border-border bg-elevated px-4 py-3 text-xs leading-relaxed text-muted-foreground" role="status">
              {enable.detail}
            </p>
          )}
          {enable.phase === 'failed' && (
            <p className="mt-3 rounded-lg border border-border bg-elevated px-4 py-3 text-xs leading-relaxed text-muted-foreground" role="alert">
              {enable.message}
            </p>
          )}
        </>
      )}
    </section>
  )
}
