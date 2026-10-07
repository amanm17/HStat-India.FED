import { useCallback, useEffect, useRef, useState } from 'react'

import { applyLook, currentLook, type Look } from '../lib/look'

/*
 * The switch between the FED design and the secret look (lib/look).
 *
 * A full-screen sequence, about three seconds:
 *
 *   open     a portal opens from the search box - a circle that grows to
 *            cover the page, carrying a drifting field of points
 *   reveal   the look changes underneath while the page is covered, and the
 *            name decodes letter by letter: "HStat.India", then "by Aman"
 *   close    the portal shrinks into the header's brand, and the page
 *            arrives in its new look, section by section
 *
 * Reduced motion gets a short cross-fade instead. Escape or a click skips
 * to the end. Nothing here touches data: it only times applyLook().
 */

type Phase = 'idle' | 'open' | 'reveal' | 'close'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/\\'

const SCENES: Record<Look, { title: string; byline: string; tone: string }> = {
  aman: { title: 'HStat.India', byline: 'by Aman', tone: 'aman' },
  fed: { title: 'HStat.India', byline: 'Foundation for Economic Development', tone: 'fed' },
}

function prefersReduced() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function centreOf(selector: string): [number, number] {
  const el = document.querySelector(selector)

  if (!el) return [window.innerWidth / 2, window.innerHeight / 2]

  const r = el.getBoundingClientRect()

  return [r.left + r.width / 2, r.top + r.height / 2]
}

/* Letters cycle through random glyphs and settle left to right. */
function decode(el: HTMLElement | null, text: string, duration: number) {
  if (!el) return () => {}

  const start = performance.now()
  let frame = 0

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / duration)
    const settled = Math.floor(progress * text.length)

    el.textContent = text
      .split('')
      .map((ch, index) => {
        if (ch === ' ' || index < settled) return ch
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      })
      .join('')

    if (progress < 1) frame = requestAnimationFrame(tick)
    else el.textContent = text
  }

  frame = requestAnimationFrame(tick)

  return () => cancelAnimationFrame(frame)
}

/* A drifting constellation: points that ease toward a ring around the
 * centre, joined by faint lines when they are close. */
function field(canvas: HTMLCanvasElement | null, tone: string) {
  if (!canvas) return () => {}

  const ctx = canvas.getContext('2d')

  if (!ctx) return () => {}

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight

  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  ctx.scale(dpr, dpr)

  const colours = tone === 'aman' ? ['#7dd3fc', '#a78bfa', '#5eead4', '#ffffff'] : ['#7DE2D1', '#FEB95F', '#ffffff', '#C2C1C2']
  const count = w < 600 ? 70 : 140
  const cx = w / 2
  const cy = h / 2
  const radius = Math.min(w, h) * 0.32

  const points = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      tx: cx + Math.cos(angle) * radius * (0.85 + Math.random() * 0.3),
      ty: cy + Math.sin(angle) * radius * (0.85 + Math.random() * 0.3),
      r: 0.8 + Math.random() * 1.8,
      c: colours[index % colours.length],
      a: angle,
    }
  })

  let frame = 0
  const start = performance.now()

  const tick = (now: number) => {
    const t = (now - start) / 1000
    const pull = Math.min(1, t / 1.4)

    ctx.clearRect(0, 0, w, h)

    for (const p of points) {
      const spin = p.a + t * 0.35
      const tx = cx + Math.cos(spin) * (Math.hypot(p.tx - cx, p.ty - cy))
      const ty = cy + Math.sin(spin) * (Math.hypot(p.tx - cx, p.ty - cy))

      p.x += (tx - p.x) * 0.04 * pull + Math.sin(t * 2 + p.a * 5) * 0.3
      p.y += (ty - p.y) * 0.04 * pull + Math.cos(t * 2 + p.a * 5) * 0.3
    }

    ctx.lineWidth = 0.6

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 4) {
        const a = points[i]
        const b = points[j]
        const d = Math.hypot(a.x - b.x, a.y - b.y)

        if (d < 90) {
          ctx.strokeStyle = `rgba(255,255,255,${(1 - d / 90) * 0.18})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }
    }

    for (const p of points) {
      ctx.fillStyle = p.c
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)

  return () => cancelAnimationFrame(frame)
}

export function LookSwitch({ onStart }: { onStart?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [target, setTarget] = useState<Look>('aman')
  const [origin, setOrigin] = useState<[number, number]>([0, 0])
  const [exit, setExit] = useState<[number, number]>([0, 0])
  const [reduced, setReduced] = useState(false)

  const title = useRef<HTMLSpanElement>(null)
  const byline = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const timers = useRef<number[]>([])
  const stops = useRef<(() => void)[]>([])

  const clear = useCallback(() => {
    timers.current.forEach(id => window.clearTimeout(id))
    timers.current = []
    stops.current.forEach(stop => stop())
    stops.current = []
  }, [])

  const finish = useCallback(
    (look: Look) => {
      clear()
      if (currentLook() !== look) applyLook(look)
      setPhase('idle')
    },
    [clear],
  )

  useEffect(() => {
    const onLook = (event: Event) => {
      const look = (event as CustomEvent<Look>).detail

      if (look !== 'aman' && look !== 'fed') return
      if (look === currentLook() && phase === 'idle') {
        /* Already there: a short pulse on the brand says the code was heard. */
        document.documentElement.classList.add('look-pulse')
        window.setTimeout(() => document.documentElement.classList.remove('look-pulse'), 900)
        return
      }

      clear()
      onStart?.()

      const calm = prefersReduced()

      setReduced(calm)
      setTarget(look)
      setOrigin(centreOf('.search-hub input, .search-primary'))
      setPhase('open')

      if (calm) {
        timers.current.push(window.setTimeout(() => applyLook(look), 180))
        timers.current.push(window.setTimeout(() => finish(look), 700))
        return
      }

      timers.current.push(
        window.setTimeout(() => {
          applyLook(look)
          setPhase('reveal')
        }, 750),
      )

      timers.current.push(
        window.setTimeout(() => {
          setExit(centreOf('.identity .brand, .identity'))
          setPhase('close')
          /* The page starts rising while the portal shrinks, so there is
           * never a blank frame between the two. */
          const root = document.documentElement
          root.classList.add('look-arrive')
          window.setTimeout(() => root.classList.remove('look-arrive'), 1700)
        }, 2650),
      )

      timers.current.push(window.setTimeout(() => finish(look), 3400))
    }

    window.addEventListener('hstat:look', onLook)

    return () => window.removeEventListener('hstat:look', onLook)
  }, [clear, finish, onStart, phase])

  /* The text and the field run while the portal is open. */
  useEffect(() => {
    if (phase === 'open' && !reduced) {
      stops.current.push(field(canvas.current, SCENES[target].tone))
    }

    if (phase === 'reveal') {
      const scene = SCENES[target]

      if (byline.current) byline.current.textContent = ''
      stops.current.push(decode(title.current, scene.title, 700))

      const id = window.setTimeout(() => {
        stops.current.push(decode(byline.current, scene.byline, scene.byline.length > 12 ? 650 : 420))
      }, 620)

      timers.current.push(id)
    }
  }, [phase, reduced, target])

  useEffect(() => {
    if (phase === 'idle') return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(target)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [phase, target, finish])

  useEffect(() => clear, [clear])

  if (phase === 'idle') return null

  const style = {
    '--ox': `${origin[0]}px`,
    '--oy': `${origin[1]}px`,
    '--ex': `${exit[0]}px`,
    '--ey': `${exit[1]}px`,
  } as React.CSSProperties

  return (
    <div
      className={`look-switch ${phase}${reduced ? ' calm' : ''}`}
      data-tone={SCENES[target].tone}
      style={style}
      role="status"
      aria-live="polite"
      onClick={() => finish(target)}
    >
      <div className="look-portal">
        <div className="look-sheen" aria-hidden="true" />
        <div className="look-grid" aria-hidden="true" />
        <canvas ref={canvas} className="look-field" aria-hidden="true" />

        <div className="look-name">
          <span ref={title} className="look-title" aria-hidden="true" />
          <span className="look-rule" aria-hidden="true" />
          <span ref={byline} className="look-byline" aria-hidden="true" />
          <span className="sr-only">
            {target === 'aman' ? 'Switched to HStat.India by Aman' : 'Switched to the FED design'}
          </span>
        </div>

        <span className="look-skip" aria-hidden="true">
          <span className="key">Esc to skip</span>
          <span className="touch">Tap to skip</span>
        </span>
      </div>
    </div>
  )
}
