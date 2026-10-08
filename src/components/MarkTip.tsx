import { useEffect, useRef, useState } from 'react'

/*
 * The explanation behind a * or ** mark.
 *
 * The marks used the browser's own title tooltip, which waits about a second,
 * never appears on a phone, and is easy to miss on a superscript a few pixels
 * wide - readers hovered and saw nothing. This is one tooltip for the whole
 * page: any element with data-tip shows it at once on hover, on keyboard
 * focus, or on a tap, fixed to the viewport so a table's scroll container
 * cannot clip it.
 */
type Tip = { text: string; x: number; top: number; bottom: number }

export function MarkTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const place = (host: HTMLElement) => {
      const text = host.dataset.tip

      if (!text) return false

      const r = host.getBoundingClientRect()

      current.current = host
      setTip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
      return true
    }

    const show = (el: Element | null) => {
      const host = el?.closest?.('[data-tip]') as HTMLElement | null

      return host ? place(host) : false
    }

    const over = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') show(event.target as Element)
    }

    const out = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const to = event.relatedTarget as Element | null
      if (!to?.closest?.('[data-tip]')) hide()
    }

    const focus = (event: FocusEvent) => {
      if (!show(event.target as Element)) hide()
    }

    /* A tap shows it; a tap anywhere else hides it. */
    const tap = (event: MouseEvent) => {
      if (!show(event.target as Element)) hide()
    }

    const hide = () => {
      current.current = null
      setTip(null)
    }

    /* Scrolling carries the mark away; the tip follows it, and goes once
     * the mark has left the screen. */
    const follow = () => {
      const host = current.current

      if (!host || !host.isConnected) return hide()

      const r = host.getBoundingClientRect()

      if (r.bottom < 0 || r.top > window.innerHeight) return hide()

      place(host)
    }

    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('focusin', focus)
    document.addEventListener('click', tap)
    window.addEventListener('scroll', follow, { passive: true, capture: true })
    window.addEventListener('resize', hide)

    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('click', tap)
      window.removeEventListener('scroll', follow, { capture: true })
      window.removeEventListener('resize', hide)
    }
  }, [])

  if (!tip) return null

  const width = Math.min(300, window.innerWidth - 24)
  const left = Math.max(12, Math.min(tip.x - width / 2, window.innerWidth - width - 12))
  const above = tip.top > 120

  return (
    <div
      className={above ? 'mark-tip above' : 'mark-tip below'}
      role="tooltip"
      style={{
        left,
        width,
        top: above ? tip.top - 8 : tip.bottom + 8,
        ['--arrow' as string]: `${Math.round(tip.x - left)}px`,
      }}
    >
      {tip.text}
    </div>
  )
}
