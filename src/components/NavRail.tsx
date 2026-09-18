import { useEffect, useState } from 'react'
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Database,
  Home,
  Layers,
  Pin,
  Search,
  Terminal,
} from 'lucide-react'

import type { CodeRef } from '../lib/workspace'

/*
 * The left rail: where you can go.
 *
 * Deliberately split from the right-hand rail, which is what you can *do* to
 * the page in front of you — arrange its tiles, build a report from it. Two
 * rails with one job each is easier to learn than one rail with two, and it
 * means neither has to explain itself.
 *
 * Nothing here is a new capability. Pins, history and the search box already
 * existed; they were just scattered across a header, a drawer and a page, so
 * a reader had to know where each one lived. This puts them where the eye
 * goes first and where they stay put between pages.
 *
 * Collapsed to icons by default on anything narrow, because on a product page
 * the data is the point and 220px of chrome is not.
 */
const STORE = 'hstat.nav.open'

function read(): boolean {
  try {
    const saved = window.localStorage.getItem(STORE)

    if (saved !== null) return saved === '1'
  } catch {
    /* private window, blocked storage: fall through to the default */
  }

  return window.innerWidth >= 1280
}

export function NavRail({
  pinned,
  recent,
  onHome,
  onOpen,
  onSearch,
  onGuide,
  onTariffLines,
  onAvailability,
  onQuery,
  active,
}: {
  pinned: CodeRef[]
  recent: CodeRef[]
  onHome: () => void
  onOpen: (ref: CodeRef) => void
  onSearch: () => void
  onGuide: () => void
  onTariffLines: () => void
  onAvailability: () => void
  onQuery: () => void
  /* The code the page is currently showing, so the rail can mark it. */
  active: string | null
}) {
  const [open, setOpen] = useState(read)

  useEffect(() => {
    document.documentElement.dataset.nav = open ? 'open' : 'icons'

    try {
      window.localStorage.setItem(STORE, open ? '1' : '0')
    } catch {
      /* not worth failing a render over */
    }
  }, [open])

  const entry = (ref: CodeRef) => (
    <li key={`${ref.level}-${ref.code}`}>
      <button
        className={ref.code === active ? 'nav-item current' : 'nav-item'}
        onClick={() => onOpen(ref)}
        title={`HS-${ref.level} ${ref.code} · ${ref.label}`}
      >
        <span className="nav-code">{ref.code}</span>
        <span className="nav-label">{ref.label}</span>
      </button>
    </li>
  )

  return (
    <nav className="navrail" aria-label="Dashboard navigation">
      <div className="nav-top">
        <button className="nav-action" onClick={onHome} title="Front page">
          <Home size={16} />
          <span>Home</span>
        </button>

        <button className="nav-action" onClick={onSearch} title="Search (press /)">
          <Search size={16} />
          <span>Search</span>
          <kbd>/</kbd>
        </button>

        <button
          className="nav-action"
          onClick={onTariffLines}
          title="India's eight-digit tariff lines"
        >
          <Layers size={16} />
          <span>Tariff lines</span>
        </button>

        <button
          className="nav-action"
          onClick={onAvailability}
          title="What Comtrade holds, and which of our products are thin"
        >
          <Database size={16} />
          <span>Availability</span>
        </button>

        <button className="nav-action" onClick={onQuery} title="Build a Comtrade query">
          <Terminal size={16} />
          <span>Query builder</span>
        </button>

        <button className="nav-action" onClick={onGuide} title="How to read this dashboard">
          <BookOpen size={16} />
          <span>Guide</span>
        </button>
      </div>

      {pinned.length > 0 && (
        <div className="nav-group">
          <div className="nav-group-head">
            <Pin size={12} />
            <span>Pinned</span>
          </div>

          <ul>{pinned.map(entry)}</ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className="nav-group">
          <div className="nav-group-head">
            <Clock size={12} />
            <span>Recent</span>
          </div>

          <ul>{recent.slice(0, 8).map(entry)}</ul>
        </div>
      )}

      <button
        className="nav-collapse"
        onClick={() => setOpen(value => !value)}
        aria-label={open ? 'Collapse navigation' : 'Expand navigation'}
        title={open ? 'Collapse' : 'Expand'}
      >
        {open ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
      </button>
    </nav>
  )
}
