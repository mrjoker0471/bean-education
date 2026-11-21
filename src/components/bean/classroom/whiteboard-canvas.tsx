'use client'

// ─── BEAN Live Classroom (Phase 5): collaborative whiteboard ──────────────────
// A real, real-time whiteboard over LiveKit reliable data messages:
//   • normalised 0..1 coordinates — canvas resizes never corrupt strokes
//   • high-DPI aware rendering (devicePixelRatio)
//   • teacher draws (pen/eraser, palette colours, brush size, undo, clear);
//     students see updates live and CANNOT mutate the board
//   • late joiners are restored from the persisted snapshot + a live sync
//   • no images, no arbitrary payloads — the stroke shape is validated in
//     src/lib/livekit/whiteboard.ts on both sides

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Undo2, Trash2, PenTool } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WBStrokeDTO } from '@/lib/types'
import { WB_COLORS, WB_MAX_STROKES } from '@/lib/livekit/whiteboard'

interface WhiteboardCanvasProps {
  strokes: WBStrokeDTO[]
  isTeacher: boolean
  onAddStroke?: (stroke: WBStrokeDTO) => void
  onUndo?: () => void
  onClear?: () => void
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: WBStrokeDTO, width: number, height: number) {
  if (stroke.points.length < 2) return
  ctx.save()
  ctx.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.mode === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color
  ctx.lineWidth = stroke.size * (stroke.mode === 'eraser' ? 4 : 1)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const [x0, y0] = stroke.points[0]
  ctx.moveTo(x0 * width, y0 * height)
  for (let i = 1; i < stroke.points.length; i++) {
    const [x, y] = stroke.points[i]
    ctx.lineTo(x * width, y * height)
  }
  ctx.stroke()
  ctx.restore()
}

export function WhiteboardCanvas({ strokes, isTeacher, onAddStroke, onUndo, onClear }: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<WBStrokeDTO | null>(null)
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [color, setColor] = useState<string>(WB_COLORS[0])
  const [size, setSize] = useState(3)
  const [boardFull, setBoardFull] = useState(false)

  // Redraw on stroke changes and resize (high-DPI + normalised coordinates).
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = wrap.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    // Beige board surface under the strokes.
    ctx.fillStyle = 'rgba(245, 240, 225, 0.06)'
    ctx.fillRect(0, 0, width, height)
    for (const stroke of strokes) drawStroke(ctx, stroke, width, height)
    const current = currentStrokeRef.current
    if (current) drawStroke(ctx, current, width, height)
  }, [strokes])

  useEffect(() => {
    redraw()
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => redraw())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [redraw])

  // ─── Teacher pointer input ────────────────────────────────────────────────
  const toNormalised = useCallback((e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return [Number(x.toFixed(4)), Number(y.toFixed(4))]
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isTeacher || !onAddStroke) return
    const point = toNormalised(e)
    if (!point) return
    if (strokes.length >= WB_MAX_STROKES) {
      setBoardFull(true)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    currentStrokeRef.current = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode: tool,
      color,
      size,
      points: [point, point],
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentStrokeRef.current) return
    const point = toNormalised(e)
    if (!point) return
    const stroke = currentStrokeRef.current
    const last = stroke.points[stroke.points.length - 1]
    // Thin-out rapid pointer events for bounded payloads.
    if (Math.abs(point[0] - last[0]) < 0.002 && Math.abs(point[1] - last[1]) < 0.002) return
    stroke.points.push(point)
    redraw()
  }

  const endStroke = () => {
    if (!drawingRef.current || !currentStrokeRef.current) return
    drawingRef.current = false
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    if (stroke.points.length >= 2 && onAddStroke) {
      onAddStroke(stroke)
    } else {
      redraw()
    }
  }

  const atLimit = strokes.length >= WB_MAX_STROKES

  return (
    <div className="flex flex-col gap-2">
      {isTeacher && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={tool === 'pen' ? 'default' : 'ghost'}
              className={cn(tool === 'pen' ? 'bg-gold text-primary-foreground hover:bg-gold-hover' : 'text-muted-foreground hover:bg-elevated')}
              onClick={() => setTool('pen')}
              aria-pressed={tool === 'pen'}
            >
              <PenTool className="h-4 w-4" />
              <span className="ml-1.5">Pen</span>
            </Button>
            <Button
              size="sm"
              variant={tool === 'eraser' ? 'default' : 'ghost'}
              className={cn(tool === 'eraser' ? 'bg-gold text-primary-foreground hover:bg-gold-hover' : 'text-muted-foreground hover:bg-elevated')}
              onClick={() => setTool('eraser')}
              aria-pressed={tool === 'eraser'}
            >
              <Eraser className="h-4 w-4" />
              <span className="ml-1.5">Eraser</span>
            </Button>
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Board colour">
            {WB_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c && tool === 'pen'}
                aria-label={`Colour ${c}`}
                onClick={() => { setColor(c); setTool('pen') }}
                className={cn('h-5 w-5 rounded-full border', color === c && tool === 'pen' ? 'border-gold ring-1 ring-gold' : 'border-border')}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Size
            <input
              type="range"
              min={1}
              max={24}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="h-1 w-24 accent-[#d4af37]"
              aria-label="Brush size"
            />
          </label>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-[11px] text-muted-foreground">{strokes.length}/{WB_MAX_STROKES}</span>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-elevated" onClick={onUndo} disabled={!strokes.length} aria-label="Undo last stroke">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={onClear} disabled={!strokes.length} aria-label="Clear board">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <div ref={wrapRef} className="relative h-[46vh] min-h-[280px] w-full overflow-hidden rounded-xl border border-border bg-card">
        <canvas
          ref={canvasRef}
          className={cn('h-full w-full touch-none', isTeacher ? 'cursor-crosshair' : 'cursor-default')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          aria-label={isTeacher ? 'Interactive whiteboard' : 'Whiteboard (view only)'}
          role="img"
        />
        {!isTeacher && (
          <span className="absolute right-2 top-2 rounded-md border border-border bg-black/60 px-2 py-1 text-[11px] text-muted-foreground">
            View only — the teacher controls the board
          </span>
        )}
        {(atLimit || boardFull) && (
          <span className="absolute bottom-2 left-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            The board is full — undo strokes to continue.
          </span>
        )}
      </div>
    </div>
  )
}
