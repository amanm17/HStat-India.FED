import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/*
 * A panel that comes up from the bottom of a phone.
 *
 * WHY THE BOTTOM
 *
 * The top of a 6-inch screen is the part a thumb cannot reach. Everything a
 * reader has to touch repeatedly - navigation, search, the tile list - sits
 * in the lower third, and a sheet is the only shape that puts a full panel
 * there without the page jumping.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not drag. A drag-to-dismiss sheet has to guess, every frame,
 * whether a downward swipe means "close me" or "scroll my contents", and it
 * guesses wrong often enough to feel broken on a long list. There is a close
 * button, the backdrop closes it, Escape closes it, and the Android back
 * gesture closes it through history. Four ways out, none of them ambiguous.
 *
 * FOUR THINGS IT DOES DO, EACH BECAUSE ITS ABSENCE IS FELT
 *
 *   - locks the page behind it, so a scroll inside the sheet cannot start
 *     scrolling the page underneath once the list ends
 *   - keeps the keyboard inside itself, so tabbing cannot land on a control
 *     the reader cannot see
 *   - returns focus to whatever opened it
 *   - sits above the tab bar and clear of the home indicator
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  /* A sheet that is mostly a list wants the height; one that is a short menu
   * should only be as tall as it needs. */
  tall = false,
  labelledBy,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  tall?: boolean
  labelledBy?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    restore.current = document.activeElement as HTMLElement | null

    /* Lock the page, remembering what it was so a second sheet closing does
     * not leave the body scrollable-but-fixed. */
    const previous = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    const first = panel.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )

    first?.focus()

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !panel.current) return

      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(el => el.offsetParent !== null)

      if (focusable.length === 0) return

      const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1]

      if (document.activeElement === edge) {
        event.preventDefault()
        ;(event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus()
      }
    }

    document.addEventListener('keydown', onKey, true)

    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey, true)
      restore.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-layer">
      <button
        className="sheet-scrim"
        aria-label={`Close ${title}`}
        onClick={onClose}
        tabIndex={-1}
      />

      <div
        className={tall ? 'sheet tall' : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        ref={panel}
      >
        <div className="sheet-head">
          {/* Not a drag handle. It is the shape people read as "this came up
              from the bottom", and it is the only part of the pattern worth
              keeping once dragging is gone. */}
          <div className="sheet-grip" aria-hidden="true" />

          <h2>{title}</h2>

          <button className="sheet-close" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={18} />
          </button>
        </div>

        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
