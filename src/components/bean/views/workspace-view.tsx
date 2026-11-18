'use client'

// ─── My Learning Workspace (Phase 2B, Milestone D) ─────────────────────────────
// The signed-in student's personal library over the EXISTING materials + Riishe
// pipeline — no second upload or extraction engine:
//   • My Library: every owned document with honest processing status
//   • My Subjects: documents grouped by their subject label
//   • Search within your own materials (title, subject, topic, document topics)
//   • Continue studying / practise from an analysed document
//   • Re-organise: set the subject label per document (rename API)
// Ownership is enforced server-side (guest or signed-in scope); nothing here
// is public. Guest users keep using the original #/materials view unchanged.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/bean/empty-state'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDate } from '@/components/bean/format'
import {
  BookOpen,
  FileText,
  FolderOpen,
  GraduationCap,
  Loader2,
  PenLine,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import type { MaterialListItemDTO, MaterialsResponseDTO } from '@/lib/types'

const STATUS_META: Record<string, { label: string; className: string }> = {
  READY: { label: 'Ready', className: 'border-success/40 text-success bg-success/10' },
  QUEUED: { label: 'Queued', className: 'border-border text-muted-foreground bg-muted' },
  EXTRACTING: { label: 'Extracting', className: 'border-gold/40 text-gold bg-gold/10' },
  ANALYSING: { label: 'Analysing', className: 'border-gold/40 text-gold bg-gold/10' },
  NEEDS_OCR: { label: 'Needs OCR', className: 'border-gold/40 text-gold bg-gold/10' },
  FAILED: { label: 'Failed', className: 'border-destructive/40 text-destructive bg-destructive/10' },
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: 'border-border text-muted-foreground bg-muted' }
  return <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className)}>{meta.label}</span>
}

export function WorkspaceView() {
  const guestId = useAppStore(s => s.guestId)
  const authedStudent = useAppStore(s => s.authedStudent)
  const navigate = useAppStore(s => s.navigate)
  const [materials, setMaterials] = useState<MaterialListItemDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState<MaterialListItemDTO | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!guestId) return
    let cancelled = false
    api
      .materials(guestId)
      .then((res: MaterialsResponseDTO) => !cancelled && setMaterials(res.materials))
      .catch(e => !cancelled && setFailed(e instanceof Error ? e.message : 'Could not load your library.'))
    return () => {
      cancelled = true
    }
  }, [guestId, reloadKey])

  const subjects = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of materials ?? []) {
      const key = m.subjectLabel?.trim() || 'Unsorted'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [materials])

  const filtered = useMemo(() => {
    let list = materials ?? []
    if (subjectFilter) {
      list = list.filter(m => (m.subjectLabel?.trim() || 'Unsorted') === subjectFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(m =>
        [m.title, m.originalName, m.subjectLabel, m.topicLabel, m.examLabel, ...m.topics]
          .filter((v): v is string => typeof v === 'string')
          .some(v => v.toLowerCase().includes(q)),
      )
    }
    return list
  }, [materials, search, subjectFilter])

  const retry = async (id: string) => {
    try {
      await api.retryMaterial(id, guestId)
      setReloadKey(k => k + 1)
    } catch {
      /* the list keeps the honest FAILED state; a toast would be nicer but
         the status stays truthful either way */
    }
  }

  if (!materials && !failed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading your library">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState icon={RefreshCw} title="Could not load your library" description={failed} actionLabel="Try again" onAction={() => { setFailed(null); setReloadKey(k => k + 1) }} />
      </div>
    )
  }

  const readyCount = (materials ?? []).filter(m => m.status === 'READY').length
  const busyCount = (materials ?? []).filter(m => ['QUEUED', 'EXTRACTING', 'ANALYSING'].includes(m.status)).length

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">My learning workspace</p>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Learning</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {(materials ?? []).length === 0
              ? 'Your personal library.'
              : `${(materials ?? []).length} document${(materials ?? []).length === 1 ? '' : 's'} · ${readyCount} ready${busyCount > 0 ? ` · ${busyCount} processing` : ''}`}
            {authedStudent ? ' · private to your account' : ' · private to this device session'}
          </p>
        </div>
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'materials' })}>
          <FileText className="mr-1.5 h-4 w-4" aria-hidden /> Upload new material
        </Button>
      </header>

      {(materials ?? []).length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={FolderOpen}
            title="Your library is empty"
            description="Upload a PDF — Riishe reads it, maps the topics and builds practice sets. Guests can use everything too; an account keeps your library across devices."
            actionLabel="Upload your first material"
            onAction={() => navigate({ view: 'materials' })}
          />
        </div>
      ) : (
        <>
          {/* My Subjects */}
          <section aria-label="My subjects" className="mt-8">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
              <BookOpen className="h-4 w-4 text-gold" aria-hidden /> My subjects
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={subjectFilter === null}
                onClick={() => setSubjectFilter(null)}
                className={cn(
                  'min-h-9 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                  subjectFilter === null ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                )}
              >
                All ({(materials ?? []).length})
              </button>
              {subjects.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={subjectFilter === name}
                  onClick={() => setSubjectFilter(subjectFilter === name ? null : name)}
                  className={cn(
                    'min-h-9 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                    subjectFilter === name ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                  )}
                >
                  {name} ({count})
                </button>
              ))}
            </div>
          </section>

          {/* Search */}
          <section aria-label="Search your materials" className="mt-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search your documents, subjects and topics…"
                aria-label="Search your materials"
                className="border-border bg-card pl-9"
              />
            </div>
          </section>

          {/* Library */}
          <section aria-label="My library" className="mt-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
              <FolderOpen className="h-4 w-4 text-gold" aria-hidden /> My library
            </h2>
            {filtered.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={Search}
                  title="Nothing matches this filter"
                  description="Try a different search term or subject — your library itself is unchanged."
                />
              </div>
            ) : (
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {filtered.map(m => {
                  const ready = m.status === 'READY'
                  return (
                    <li key={m.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">{m.title}</h3>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[m.subjectLabel, m.topicLabel, m.examLabel].filter(Boolean).join(' · ') || 'No subject yet'}
                          </p>
                        </div>
                        <StatusBadge status={m.status} />
                      </div>

                      {m.statusDetail && (
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{m.statusDetail}</p>
                      )}
                      {m.topics.length > 0 && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          <span className="text-gold">Topics:</span> {m.topics.slice(0, 5).join(' · ')}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-border text-muted-foreground hover:bg-elevated"
                          onClick={() => navigate({ view: 'riishe', docId: m.id })}
                          aria-label={`Open workspace for ${m.title}`}
                        >
                          <GraduationCap className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Workspace
                        </Button>
                        {ready && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-gold/40 text-gold hover:bg-gold/10"
                            onClick={() => navigate({ view: 'practice', doc: m.id })}
                            aria-label={`Practise from ${m.title}`}
                          >
                            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Practise
                          </Button>
                        )}
                        {(m.status === 'FAILED' || m.status === 'NEEDS_OCR') && (
                          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => retry(m.id)}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Retry
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          onClick={() => setEditing(m)}
                          aria-label={`Organise ${m.title} into a subject`}
                        >
                          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Organise
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">Updated {formatDate(m.updatedAt)}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {editing && (
        <OrganiseDialog
          doc={editing}
          guestId={guestId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setReloadKey(k => k + 1)
          }}
        />
      )}
    </div>
  )
}

function OrganiseDialog({
  doc,
  guestId,
  onClose,
  onSaved,
}: {
  doc: MaterialListItemDTO
  guestId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(doc.title)
  const [subject, setSubject] = useState(doc.subjectLabel ?? '')
  const [topic, setTopic] = useState(doc.topicLabel ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await api.renameMaterial(doc.id, guestId, {
        title: title.trim() || undefined,
        subjectLabel: subject.trim() || null,
        topicLabel: topic.trim() || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Organise document">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <PenLine className="h-4 w-4 text-gold" aria-hidden /> Organise “{doc.title}”
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Labels group documents in your workspace — they are yours and never shown to anyone else.
        </p>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-title">Title</Label>
            <Input id="org-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-subject">Subject</Label>
            <Input id="org-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} placeholder="e.g. Physics, Financial Accounting" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-topic">Topic</Label>
            <Input id="org-topic" value={topic} onChange={e => setTopic(e.target.value)} maxLength={120} placeholder="e.g. Thermodynamics, Chapter 4" />
          </div>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
