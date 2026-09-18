import { useEffect, useRef, useState } from 'react'
import { BookOpen, HelpCircle, X } from 'lucide-react'

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
 */
export type HelpTopic = {
  title: string
  lines: string[]
  /* The misreading this page invites, said plainly. Every page here has one. */
  watch?: string
}

export function HelpButton({
  topic,
  onGuide,
}: {
  topic: HelpTopic
  onGuide: () => void
}) {
  const [open, setOpen] = useState(false)
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

  return (
    <div className="helpdock" ref={shell}>
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

      <button
        className={open ? 'helpbutton open' : 'helpbutton'}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-label="What am I looking at?"
        title="What am I looking at?"
      >
        <HelpCircle size={18} />
      </button>
    </div>
  )
}
