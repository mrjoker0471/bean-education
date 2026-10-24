import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Light in-memory rate limit: 20 requests / 5 minutes per guest
const rateMap = new Map<string, number[]>()
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 5 * 60_000

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(8000),
  })).min(1).max(24),
  context: z.object({
    examSlug: z.string().optional(),
    examName: z.string().optional(),
    stageName: z.string().optional(),
    subjectName: z.string().optional(),
    topicId: z.string().optional(),
    topicName: z.string().optional(),
    noteTitle: z.string().optional(),
    questionText: z.string().max(2000).optional(),
    questionOptions: z.array(z.string().max(500)).max(6).optional(),
    attemptSummary: z.string().max(1000).optional(),
  }).default({}),
  settings: z.object({
    style: z.enum(['exam-focused', 'simple', 'detailed']).default('exam-focused'),
    showSourceContext: z.boolean().default(true),
  }).default({ style: 'exam-focused', showSourceContext: true }),
})

const STYLE_PROMPTS: Record<string, string> = {
  'exam-focused': 'Answer in an exam-oriented way: crisp, factual, structured with short headings or bullets, include memory hooks and common exam traps where relevant.',
  'simple': 'Answer in simple, plain language a beginner can follow. Use short sentences and everyday examples.',
  'detailed': 'Answer thoroughly: explain the concept, give context, worked examples, and a short revision summary at the end.',
}

export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, messages, context, settings } = parsed.data

    // Rate limit
    const now = Date.now()
    const hits = (rateMap.get(guestId) ?? []).filter(t => now - t < RATE_WINDOW_MS)
    if (hits.length >= RATE_LIMIT) {
      return NextResponse.json({ error: 'Too many requests — please wait a moment and try again.' }, { status: 429 })
    }
    hits.push(now)
    rateMap.set(guestId, hits)

    // ── Load authorized context (only what was actually supplied to the model) ──
    const usedContext: string[] = []
    const contextLines: string[] = []
    let noteExcerpt = ''

    if (context.topicId) {
      const topic = await db.topic.findUnique({
        where: { id: context.topicId },
        include: {
          notes: true,
          unit: { include: { subject: { include: { stage: { include: { exam: true } } } } } },
        },
      })
      if (topic) {
        const exam = topic.unit.subject.stage.exam
        contextLines.push(`Exam: ${exam.name} (${exam.shortName ?? exam.slug})`)
        contextLines.push(`Stage: ${topic.unit.subject.stage.name}`)
        contextLines.push(`Subject: ${topic.unit.subject.name}`)
        contextLines.push(`Topic: ${topic.name}`)
        usedContext.push('exam & topic context')
        if (topic.notes[0]) {
          noteExcerpt = topic.notes[0].markdown.slice(0, 3500)
          usedContext.push(`study note: "${topic.notes[0].title}"`)
        }
      }
    } else {
      if (context.examName) { contextLines.push(`Exam: ${context.examName}`); usedContext.push('exam context') }
      if (context.stageName) contextLines.push(`Stage: ${context.stageName}`)
      if (context.subjectName) contextLines.push(`Subject: ${context.subjectName}`)
      if (context.topicName) { contextLines.push(`Topic: ${context.topicName}`); usedContext.push('topic name') }
    }
    if (context.questionText) {
      contextLines.push(`Question under discussion: ${context.questionText}`)
      if (context.questionOptions?.length) {
        contextLines.push(`Options: ${context.questionOptions.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join(' | ')}`)
      }
      usedContext.push('selected question')
    }
    if (context.attemptSummary) {
      contextLines.push(`Student's recent test performance: ${context.attemptSummary}`)
      usedContext.push('recent test summary')
    }

    const stylePrompt = STYLE_PROMPTS[settings.style] ?? STYLE_PROMPTS['exam-focused']

    const systemContent = [
      'You are BEAN Intelligence, the learning companion inside BEAN EXAMS — an Indian competitive-examination preparation platform (TNPSC, UPSC, SSC, Banking, Railways, Defence, NEET/JEE, teaching and state PSC exams).',
      'Your job: help the student understand concepts, explain mistakes, summarise study notes, generate revision questions and build revision plans.',
      stylePrompt,
      'Rules:',
      '- Ground your answer in the STUDENT CONTEXT block when it is present. If you were given a study note, treat it as the primary reference for that topic.',
      '- Never claim you have read a resource, PDF or test result unless its content appears in the STUDENT CONTEXT block.',
      '- If you are unsure or the information may be outdated (current affairs, vacancies, dates, cut-offs), say so and advise checking the official notification.',
      '- Never reveal or guess hidden answer keys to live tests. If asked, explain how to approach the question instead.',
      '- Keep responses in Markdown, concise enough for study use. Do not pad.',
      contextLines.length ? `\nSTUDENT CONTEXT:\n${contextLines.join('\n')}` : '',
      noteExcerpt ? `\nTOPIC STUDY NOTE (authoritative for this topic):\n"""\n${noteExcerpt}\n"""` : '',
    ].filter(Boolean).join('\n')

    // Cap conversation history
    const trimmed = messages.slice(-12)
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemContent },
        ...trimmed,
      ],
      thinking: { type: 'disabled' },
    })

    const reply = completion.choices[0]?.message?.content
    if (!reply || !reply.trim()) {
      return NextResponse.json({ error: 'The AI provider returned an empty response. Please try again.' }, { status: 502 })
    }

    return NextResponse.json({ reply, usedContext })
  } catch (err) {
    console.error('[api/bean/chat]', err)
    return NextResponse.json(
      { error: 'BEAN Intelligence provider is temporarily unavailable. Please try again shortly.' },
      { status: 502 }
    )
  }
}
