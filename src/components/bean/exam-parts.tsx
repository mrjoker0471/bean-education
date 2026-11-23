'use client'

// Reusable building blocks for the ExamView detail page (Task 4-a).
// Extended for the three-layer learning system: official document cards,
// pattern summary strip and the Layer-1 study syllabus with inline topic notes.

import { useState } from 'react'
import { api } from '@/lib/api'
import type {
  ResourceDTO,
  StagePatternDTO,
  SubjectNode,
  TestTemplateDTO,
  TopicDetailDTO,
  TopicNode,
} from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { CountPill } from '@/components/bean/count-pill'
import { AccessTypeBadge, ResourceStatusBadge } from '@/components/bean/status-badge'
import { Markdown } from '@/components/bean/markdown'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileDown,
  Globe,
  HelpCircle,
  Landmark,
  Loader2,
  MinusCircle,
  Play,
  ScrollText,
  Sparkles,
} from 'lucide-react'

/** Honest negative-marking copy: "−0.25 per wrong answer" or "No negative marking". */
export function negativeMarkText(negativeMark: number): string {
  return negativeMark > 0
    ? `\u2212${negativeMark} per wrong answer`
    : 'No negative marking'
}

function NegativeMarkBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        value > 0
          ? 'border-gold/40 bg-gold/10 text-gold'
          : 'border-success/40 bg-success/10 text-success'
      )}
    >
      {value > 0 ? <MinusCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {negativeMarkText(value)}
    </span>
  )
}

// ─── Stage marking-pattern table ───
export function PatternTable({ pattern }: { pattern: StagePatternDTO }) {
  const hasSections = pattern.sections.length > 0
  return (
    <div>
      {hasSections && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-elevated hover:bg-elevated">
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Section</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">Questions</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">Marks</TableHead>
                  <TableHead className="hidden text-right text-xs uppercase tracking-wide text-muted-foreground sm:table-cell">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pattern.sections.map(section => (
                  <TableRow key={section.name} className="border-border">
                    <TableCell className="text-sm text-foreground">{section.name}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{section.questions}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{section.marks}</TableCell>
                    <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                      {section.durationMin ? `${section.durationMin} min` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-border bg-card/70">
                  <TableCell className="text-sm font-semibold text-foreground">Total</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-gold">{pattern.totalQuestions}</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-gold">{pattern.totalMarks}</TableCell>
                  <TableCell className="hidden text-right text-sm font-semibold text-gold sm:table-cell">{pattern.durationMin} min</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-muted-foreground">
          Duration: {pattern.durationMin} minutes
        </span>
        <NegativeMarkBadge value={pattern.negativeMark} />
        {pattern.qualifying && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-muted-foreground">
            {pattern.qualifying}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Exam-level resource list ───
export function ResourceList({ resources }: { resources: ResourceDTO[] }) {
  const navigate = useAppStore(s => s.navigate)
  return (
    <ul className="space-y-2">
      {resources.map(resource => {
        const isPdf = resource.fileKind === 'PDF'
        return (
          <li
            key={resource.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug text-foreground">{resource.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {resource.provider}
                {resource.language ? ` · ${resource.language}` : ''}
                {resource.note ? ` · ${resource.note}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ResourceStatusBadge status={resource.verificationStatus} />
                <AccessTypeBadge access={resource.accessType} />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:self-center">
              {isPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gold/40 text-gold hover:bg-gold/10"
                  onClick={() => navigate({ view: 'pdf', resourceId: resource.id })}
                  aria-label={`Open ${resource.title} in the integrated reader`}
                >
                  Open in reader <BookOpenText className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
              <Button
                asChild
                variant={isPdf ? 'ghost' : 'outline'}
                size="sm"
                className={isPdf
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'border-gold/40 text-gold hover:bg-gold/10'}
              >
                <a
                  href={isPdf ? api.pdfStreamUrl(resource.url, '1') : resource.url}
                  {...(isPdf ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}
                  aria-label={isPdf ? `Download ${resource.title}` : `Open resource: ${resource.title}`}
                >
                  {isPdf ? 'Download' : 'Open'} {isPdf ? <FileDown className="ml-1.5 h-3.5 w-3.5" /> : <ExternalLink className="ml-1.5 h-3.5 w-3.5" />}
                </a>
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Syllabus topic row ───
export function TopicRow({
  topic,
  pending,
  onStart,
}: {
  topic: TopicNode
  pending: boolean
  onStart: () => void
}) {
  const navigate = useAppStore(s => s.navigate)
  return (
    <li className="flex flex-col gap-2.5 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-elevated sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => navigate({ view: 'topic', topicId: topic.id })}
          className="text-left text-sm font-medium text-foreground transition-colors hover:text-gold"
          aria-label={`Open topic ${topic.name}`}
        >
          {topic.name}
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {topic.noteAvailable && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
              title="Original BEAN Education study note available"
            >
              <BookOpen className="h-3 w-3" /> Note
            </span>
          )}
          {topic.questionCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
              <HelpCircle className="h-3 w-3 text-gold" /> {topic.questionCount} {topic.questionCount === 1 ? 'question' : 'questions'}
            </span>
          ) : (
            <span className="text-[11px] italic text-muted-foreground">material in progress</span>
          )}
          {topic.resourceCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
              <ExternalLink className="h-3 w-3 text-gold" /> {topic.resourceCount} {topic.resourceCount === 1 ? 'resource' : 'resources'}
            </span>
          )}
        </div>
      </div>
      {topic.questionCount >= 4 && (
        <Button
          size="sm"
          disabled={pending}
          onClick={onStart}
          className="shrink-0 self-start bg-gold text-primary-foreground hover:bg-gold-hover sm:self-center"
        >
          {pending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Practice
        </Button>
      )}
    </li>
  )
}

// ─── Subject card with units accordion (Syllabus tab) ───
export function SubjectSyllabusCard({
  subject,
  pendingTopicId,
  onStartTopic,
}: {
  subject: SubjectNode
  pendingTopicId: string | null
  onStartTopic: (topic: TopicNode) => void
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-display text-base font-semibold text-foreground">{subject.name}</h4>
            {subject.description && (
              <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{subject.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CountPill label="topics" value={subject.topicCount} />
            <CountPill label="notes" value={subject.noteCount} />
            <CountPill label="questions" value={subject.questionCount} />
          </div>
        </div>

        {subject.units.length > 0 ? (
          <Accordion
            type="single"
            collapsible
            className="mt-4"
            defaultValue={subject.units[0]?.id}
          >
            {subject.units.map(unit => (
              <AccordionItem key={unit.id} value={unit.id} className="border-border last:border-b">
                <AccordionTrigger className="rounded-lg px-3 py-3 text-left hover:bg-elevated hover:no-underline">
                  <span className="flex w-full items-center justify-between gap-2 pr-2">
                    <span className="text-sm font-medium text-foreground">{unit.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {unit.topics.length} {unit.topics.length === 1 ? 'topic' : 'topics'}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <ul className="max-h-96 space-y-0.5 overflow-y-auto pr-1">
                    {unit.topics.map(topic => (
                      <TopicRow
                        key={topic.id}
                        topic={topic}
                        pending={pendingTopicId === topic.id}
                        onStart={() => onStartTopic(topic)}
                      />
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs text-muted-foreground">
            Units for this subject are being mapped — check back soon.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Practice-test template card (Tests tab) ───
export function TemplateCard({
  template,
  pending,
  error,
  onStart,
}: {
  template: TestTemplateDTO
  pending: boolean
  error: string | null
  onStart: () => void
}) {
  return (
    <Card className="flex h-full flex-col border-border bg-card">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-display text-base font-semibold leading-snug text-foreground">{template.title}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{template.description}</p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0',
              template.type === 'MIXED'
                ? 'border-gold/40 bg-gold/10 text-gold'
                : 'border-border text-muted-foreground'
            )}
          >
            {template.type === 'MIXED' ? 'Mixed mock' : 'Subject test'}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <CountPill label="questions" value={template.config.count} />
          <CountPill label="min" value={template.config.durationMin} />
          <NegativeMarkBadge value={template.config.negativeMark} />
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          disabled={pending}
          onClick={onStart}
          className="mt-4 w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto sm:self-start"
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="mr-2 h-4 w-4" aria-hidden />
          )}
          Start test
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Official document type labels ───────────────────────────────────────────
export const DOC_TYPE_LABELS: Record<string, string> = {
  OFFICIAL_SYLLABUS: 'Official syllabus',
  OFFICIAL_SUBJECT_SYLLABUS: 'Official subject syllabus (PDF)',
  OFFICIAL_BULLETIN: 'Official information bulletin',
  OFFICIAL_PORTAL: 'Official portal',
  OFFICIAL_NOTICE: 'Official document / notice',
  TEXTBOOK_PDF: 'Textbook / book archive',
  STUDY_NOTES: 'Study material',
  ARTICLE: 'Article',
  VIDEO: 'Video course',
  REVISION: 'Revision aid',
  ORIGINAL_GUIDE: 'BEAN Education original guide',
}

export function isOfficialDoc(r: ResourceDTO): boolean {
  return r.type.startsWith('OFFICIAL_')
}

// ─── Official document card (Layer 1 — Study Material) ───────────────────────
// Honest behaviour: PORTAL/WEBPAGE open as pages (never fake PDF downloads);
// PDF entries open in the integrated reader (real pdf.js rendering) with a
// separate direct-download action.
export function DocumentCard({ resource: r }: { resource: ResourceDTO }) {
  const navigate = useAppStore(s => s.navigate)
  const unreachable = r.verificationStatus === 'UNREACHABLE'
  const kind = r.fileKind ?? 'WEBPAGE'
  const isPdf = kind === 'PDF'

  const Icon = isPdf ? BookOpenText : kind === 'PORTAL' ? Landmark : ScrollText
  const actionLabel = isPdf ? 'Open in reader' : kind === 'PORTAL' ? 'Open portal' : 'Open page'
  const ActionIcon = isPdf ? BookOpenText : ExternalLink

  return (
    <li className={cn('flex h-full flex-col rounded-xl border border-border bg-card p-4', unreachable && 'opacity-80')}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
          <Icon className="h-4 w-4 text-gold" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-foreground">{r.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {r.provider} · {DOC_TYPE_LABELS[r.type] ?? r.type} · {r.language}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <ResourceStatusBadge status={r.verificationStatus} />
        <AccessTypeBadge access={r.accessType} />
        {r.docDate && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
            Dated {r.docDate}
          </span>
        )}
      </div>

      {r.note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{r.note}</p>}
      {unreachable && (
        <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground">
          This official site did not respond from our build environment ({r.lastChecked ? new Date(r.lastChecked).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : 'recently'}) — it normally works from student networks in India.
        </p>
      )}

      <div className="mt-3 flex shrink-0 flex-wrap gap-2">
        {isPdf ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'sm:w-auto sm:self-start',
                unreachable ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold hover:bg-gold/10',
              )}
              onClick={() => navigate({ view: 'pdf', resourceId: r.id })}
              aria-label={`Open ${r.title} in the integrated reader`}
            >
              {actionLabel} <BookOpenText className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground sm:self-start"
            >
              <a
                href={api.pdfStreamUrl(r.url, '1')}
                download
                aria-label={`Download PDF: ${r.title}`}
              >
                Download <FileDown className="ml-1.5 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          </>
        ) : (
          <Button
            asChild
            variant="outline"
            size="sm"
            className={cn(
              'w-full shrink-0 sm:w-auto sm:self-start',
              unreachable ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold hover:bg-gold/10',
            )}
          >
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${actionLabel}: ${r.title} (opens in a new tab)`}
            >
              {actionLabel} <ActionIcon className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        )}
      </div>
    </li>
  )
}

// ─── Pattern summary strip (kept in the exam header above the tabs) ──────────
export function PatternSummaryStrip({
  stages,
}: {
  stages: { id: string; name: string; pattern: StagePatternDTO | null }[]
}) {
  const withPattern = stages.filter(s => s.pattern)
  if (withPattern.length === 0) return null
  return (
    <div className="mt-4 flex flex-col gap-1.5" aria-label="Exam pattern summary">
      {withPattern.map(s => (
        <p key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">{s.name}:</span>
          <span>{s.pattern!.totalQuestions} questions</span>
          <span aria-hidden>·</span>
          <span>{s.pattern!.totalMarks} marks</span>
          <span aria-hidden>·</span>
          <span>{s.pattern!.durationMin} min</span>
          <span aria-hidden>·</span>
          <span className={s.pattern!.negativeMark > 0 ? 'text-gold' : 'text-success'}>
            {negativeMarkText(s.pattern!.negativeMark)}
          </span>
        </p>
      ))}
    </div>
  )
}

// ─── Layer 1: study syllabus with inline topic notes ─────────────────────────
// Inline note expansion makes the exam page a complete learning area: students
// read the note + documents here, then jump to Intelligence/Practice keeping
// the selected topic.

export interface FocusTopic {
  id: string
  name: string
  stageName: string
  subjectName: string
}

function InlineTopicPanel({
  topicId,
  examName,
  subjectName,
  onAskBean,
  onPractice,
  startingTopicId,
}: {
  topicId: string
  examName: string
  subjectName: string
  onAskBean: (t: FocusTopic, noteTitle: string | undefined) => void
  onPractice: (topicId: string) => void
  startingTopicId: string | null
}) {
  const navigate = useAppStore(s => s.navigate)
  const [dto, setDto] = useState<TopicDetailDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!dto && !error) {
    api.topic(topicId).then(setDto).catch(e => setError(e instanceof Error ? e.message : 'Failed to load this topic'))
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </p>
    )
  }

  if (!dto) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading study material">
        <Skeleton className="h-4 w-3/4 bg-elevated" />
        <Skeleton className="h-4 w-full bg-elevated" />
        <Skeleton className="h-4 w-5/6 bg-elevated" />
        <Skeleton className="h-4 w-2/3 bg-elevated" />
      </div>
    )
  }

  const focus: FocusTopic = { id: dto.topic.id, name: dto.topic.name, stageName: '', subjectName }

  return (
    <div className="rounded-lg border border-gold/20 bg-elevated/50 p-3 sm:p-4">
      {/* Note */}
      {dto.note ? (
        <div className="max-h-80 overflow-y-auto pr-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">
            Study notes — {dto.note.title}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Version {dto.note.version} · Updated {new Date(dto.note.updatedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })} · Written by BEAN Education
          </p>
          <div className="mt-2">
            <Markdown content={dto.note.markdown} />
          </div>
        </div>
      ) : (
        <p className="text-xs italic leading-relaxed text-muted-foreground">
          Original notes are being prepared for this topic — meanwhile the curated resources below and the
          practice questions available are honest, working alternatives.
        </p>
      )}

      {/* Documents / resources */}
      {dto.resources.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Documents &amp; resources for this topic ({dto.resources.length})
          </p>
          <ul className="mt-2 space-y-1.5">
            {dto.resources.slice(0, 4).map(r => {
              const isPdf = r.fileKind === 'PDF'
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {isPdf ? (
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'pdf', resourceId: r.id })}
                      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-gold"
                      aria-label={`Open ${r.title} in the integrated reader`}
                    >
                      <BookOpenText className="h-3 w-3 shrink-0 text-gold" aria-hidden />
                      {r.title}
                    </button>
                  ) : (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-gold"
                    >
                      {isOfficialDoc(r) ? <Landmark className="h-3 w-3 shrink-0 text-gold" aria-hidden /> : <Globe className="h-3 w-3 shrink-0 text-gold" aria-hidden />}
                      {r.title}
                    </a>
                  )}
                  <span className="text-[11px] text-muted-foreground/70">{r.provider}</span>
                  <ResourceStatusBadge status={r.verificationStatus} />
                </li>
              )
            })}
            {dto.resources.length > 4 && (
              <li className="text-[11px] text-muted-foreground">
                + {dto.resources.length - 4} more in the full topic workspace
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Actions — keep the selected topic context across layers */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          className="border-gold/40 text-gold hover:bg-gold/10"
          onClick={() => onAskBean(focus, dto.note?.title)}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Ask BEAN
        </Button>
        {dto.questionCount >= 4 && (
          <Button
            size="sm"
            disabled={startingTopicId === topicId}
            onClick={() => onPractice(dto.topic.id)}
            className="bg-gold text-primary-foreground hover:bg-gold-hover"
          >
            {startingTopicId === topicId
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
            Practice
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ view: 'topic', topicId: dto.topic.id })}
        >
          Full topic workspace <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden />
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Context carried: {examName} › {subjectName} › {dto.topic.name}
      </p>
    </div>
  )
}

export function StudySubjectCard({
  subject,
  stageName,
  examName,
  pendingTopicId,
  onStartTopic,
  onFocusTopic,
}: {
  subject: SubjectNode
  stageName: string
  examName: string
  pendingTopicId: string | null
  onStartTopic: (topic: TopicNode) => void
  onFocusTopic: (t: FocusTopic, noteTitle: string | undefined) => void
}) {
  const [openTopicId, setOpenTopicId] = useState<string | null>(null)
  // Inject this subject's stage into the focus context handed up to the parent
  const handleFocus = (t: FocusTopic, noteTitle: string | undefined) =>
    onFocusTopic({ ...t, stageName }, noteTitle)

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-display text-base font-semibold text-foreground">{subject.name}</h4>
            {subject.description && (
              <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{subject.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CountPill label="topics" value={subject.topicCount} />
            <CountPill label="notes" value={subject.noteCount} />
            <CountPill label="questions" value={subject.questionCount} />
          </div>
        </div>

        {subject.units.length > 0 ? (
          <Accordion type="single" collapsible className="mt-4" defaultValue={subject.units[0]?.id}>
            {subject.units.map(unit => (
              <AccordionItem key={unit.id} value={unit.id} className="border-border last:border-b">
                <AccordionTrigger className="rounded-lg px-3 py-3 text-left hover:bg-elevated hover:no-underline">
                  <span className="flex w-full items-center justify-between gap-2 pr-2">
                    <span className="text-sm font-medium text-foreground">{unit.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {unit.topics.length} {unit.topics.length === 1 ? 'topic' : 'topics'}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <ul className="max-h-[30rem] space-y-1 overflow-y-auto pr-1">
                    {unit.topics.map(topic => {
                      const expanded = openTopicId === topic.id
                      return (
                        <li key={topic.id} className="rounded-lg">
                          <div
                            className={cn(
                              'flex flex-col gap-2.5 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-elevated sm:flex-row sm:items-center sm:justify-between',
                              expanded && 'border-border bg-elevated',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setOpenTopicId(expanded ? null : topic.id)}
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? 'Hide' : 'Read'} study material for ${topic.name}`}
                                  className="mt-0.5 shrink-0 rounded text-muted-foreground transition-colors hover:text-gold"
                                >
                                  <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180 text-gold')} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOpenTopicId(expanded ? null : topic.id)}
                                  className="text-left text-sm font-medium text-foreground transition-colors hover:text-gold"
                                  aria-label={`Open study material for topic ${topic.name}`}
                                >
                                  {topic.name}
                                </button>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:pl-[22px]">
                                {topic.noteAvailable && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
                                    title="Original BEAN Education study note available"
                                  >
                                    <BookOpen className="h-3 w-3" /> Note
                                  </span>
                                )}
                                {topic.questionCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
                                    <HelpCircle className="h-3 w-3 text-gold" /> {topic.questionCount} {topic.questionCount === 1 ? 'question' : 'questions'}
                                  </span>
                                ) : (
                                  <span className="text-[11px] italic text-muted-foreground">material in progress</span>
                                )}
                                {topic.resourceCount > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
                                    <ExternalLink className="h-3 w-3 text-gold" /> {topic.resourceCount} {topic.resourceCount === 1 ? 'resource' : 'resources'}
                                  </span>
                                )}
                              </div>
                            </div>
                            {topic.questionCount >= 4 && (
                              <Button
                                size="sm"
                                disabled={pendingTopicId === topic.id}
                                onClick={() => onStartTopic(topic)}
                                className="shrink-0 self-start bg-gold text-primary-foreground hover:bg-gold-hover sm:self-center"
                              >
                                {pendingTopicId === topic.id ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                )}
                                Practice
                              </Button>
                            )}
                          </div>
                          {expanded && (
                            <div className="mt-1.5 sm:ml-[26px]">
                              <InlineTopicPanel
                                topicId={topic.id}
                                examName={examName}
                                subjectName={subject.name}
                                onAskBean={handleFocus}
                                onPractice={() => onStartTopic(topic)}
                                startingTopicId={pendingTopicId}
                              />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs text-muted-foreground">
            Units for this subject are being mapped — check back soon.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
