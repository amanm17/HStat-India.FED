import { useEffect, useRef, useState } from 'react'
import { BookOpen, HelpCircle, X } from 'lucide-react'

import type { PageHelp } from '../lib/pagehelp'

/*
 * "What am I looking at?"
 *
 * A dashboard someone else built is a room you walk into mid-conversation.
 * The guide answers the general question; this answers the one people
 * actually ask, which is about the page in front of them, and it has to be
 * answerable without leaving it.
 *
 * So: the current page explained in three lines, then a door to the guide for
 * anyone who wants the rest. Bottom right because that corner is empty on
 * every page here and because that is where people have learned to look.
 *
 * Four parts, in the order a reader asks for them:
 *
 *   what this is    the page in a line or two, from the route
 *   the code        the identifier on screen, decoded
 *   the figures     what the numbers currently rendered actually measure
 *   what is here    each block on the page and the question it answers
 *
 * The middle two come from the page itself (see lib/pagehelp), because the
 * router cannot know them and a card that only knows the route can only ever
 * repeat the heading back.
 */
export type HelpTopic = PageHelp & {
  title: string
  lines: string[]
}

export function HelpButton({
  topic,
  onGuide,
  floating = true,
  open: openProp,
  onOpenChange,
}: {
  topic: HelpTopic
  onGuide: () => void
  /*
   * The button used to float in the bottom-right corner, where, as the
   * reader scrolled, it sat over figures. On a desktop it now lives in the
   * header beside the theme switch (`floating` keeps its old name for the
   * callers); on phones and tablets the card is opened from the More sheet
   * and `open` is controlled. Nothing floats over the page either way.
   */
  floating?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value
    setOwnOpen(next)
    onOpenChange?.(next)
  }
  const shell = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointer(event: MouseEvent) {
      if (!shell.current?.contains(event.target as Node)) setOpen(false)
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!floating && !open) return null

  return (
    <div className={floating ? 'helpdock inheader' : 'helpdock docked'} ref={shell}>
      {open && (
        <div className="helpcard" role="dialog" aria-label="About this page">
          <div className="helpcard-head">
            <div>
              <div className="eyebrow">ABOUT THIS PAGE</div>
              <h3>{topic.title}</h3>
            </div>

            <button
              className="helpcard-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {topic.lines.map(line => (
            <p key={line}>{line}</p>
          ))}

          {topic.code && (
            <div className="helpcard-code">
              <div className="helpcard-code-value">{topic.code.value}</div>

              <div className="helpcard-code-what">
                {topic.code.what}
                {topic.code.note && <em>{topic.code.note}</em>}
              </div>
            </div>
          )}

          {topic.facts && topic.facts.length > 0 && (
            <div className="helpcard-block">
              <div className="helpcard-label">What the figures say</div>

              <dl className="helpcard-facts">
                {topic.facts.map(fact => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>
                      <strong>{fact.value}</strong>
                      {fact.note && <span>{fact.note}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {topic.presented && topic.presented.length > 0 && (
            <div className="helpcard-block">
              <div className="helpcard-label">What is on this page</div>

              <ul className="helpcard-panels">
                {topic.presented.map(panel => (
                  <li key={panel.name}>
                    <strong>{panel.name}</strong>
                    <span>{panel.what}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {topic.watch && (
            <p className="helpcard-watch">
              <strong>Watch out:</strong> {topic.watch}
            </p>
          )}

          <button
            className="helpcard-guide"
            onClick={() => {
              setOpen(false)
              onGuide()
            }}
          >
            <BookOpen size={14} />
            How to read this dashboard
          </button>
        </div>
      )}

      {floating && <button
        className={open ? 'helpbutton open' : 'helpbutton'}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-label="About this page"
        title="About this page"
      >
        <HelpCircle size={18} />
      </button>}
    </div>
  )
}
