import { BookOpen, Clock, Database, Home, Layers, MoreHorizontal, Pin, Search, Terminal, HelpCircle } from 'lucide-react'

import type { CodeRef } from '../lib/workspace'
import { Sheet } from './Sheet'

/*
 * The bottom bar, and the rail's job on a phone.
 *
 * It is not an extra navigation. It appears at exactly the width where
 * .navrail hides itself, so there is never a screen size with no way to get
 * anywhere - which is what the dashboard did before this: below 900px the
 * rail vanished and took tariff lines, availability, the query builder and
 * the guide with it, leaving the front page as the only route to anything.
 *
 * WHY FIVE, AND WHY THESE FIVE
 *
 * Four to six is what a thumb can hit without looking. The rail has nine
 * things; three of them are destinations people use constantly (home, the
 * tariff lines, availability), one is a verb that deserves the whole screen
 * on a phone (search), and the rest - the query builder, the guide, pinned
 * codes, recent history - are things you go to occasionally and can afford
 * one extra tap. Those live behind More.
 *
 * WHY SEARCH IS A TAB AND NOT A BOX
 *
 * The header search on a phone was 78px wide and read "Search, or". A search
 * that has to accept "smartphone", "85176290" and a slash command needs the
 * screen, and on a phone the honest way to give it the screen is to make it
 * a place you go rather than a field you squeeze in beside a wordmark.
 */
export type TabId = 'home' | 'search' | 'lines' | 'data' | 'more'

export function TabBar({
  active,
  moreOpen,
  onTab,
  onCloseMore,
  pinned,
  recent,
  onOpen,
  onGuide,
  onQuery,
  onAvailability,
  onHelp,
}: {
  active: TabId | null
  moreOpen: boolean
  onTab: (tab: TabId) => void
  onCloseMore: () => void
  pinned: CodeRef[]
  recent: CodeRef[]
  onOpen: (ref: CodeRef) => void
  onGuide: () => void
  onQuery: () => void
  onAvailability: () => void
  /* The page's own help card; on a phone it lives here, not in a corner. */
  onHelp?: () => void
}) {
  const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'lines', label: 'Lines', icon: Layers },
    { id: 'data', label: 'Coverage', icon: Database },
    { id: 'more', label: 'More', icon: MoreHorizontal },
  ]

  const entry = (ref: CodeRef) => (
    <li key={`${ref.level}-${ref.code}`}>
      <button
        onClick={() => {
          onOpen(ref)
          onCloseMore()
        }}
      >
        <span className="moresheet-code">{ref.code}</span>
        <span className="moresheet-label">{ref.label}</span>
      </button>
    </li>
  )

  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {tabs.map(tab => {
          const Icon = tab.icon
          const on = active === tab.id

          return (
            <button
              key={tab.id}
              className={on ? 'tab on' : 'tab'}
              onClick={() => onTab(tab.id)}
              aria-current={on ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={on ? 2.4 : 1.9} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      <Sheet open={moreOpen} title="More" onClose={onCloseMore}>
        <ul className="moresheet-links">
          {onHelp && (
            <li>
              <button className="moresheet-help" onClick={onHelp}>
                <HelpCircle size={17} />
                <span className="moresheet-label">About this page</span>
              </button>
            </li>
          )}
          <li>
            <button
              onClick={() => {
                onAvailability()
                onCloseMore()
              }}
            >
              <Database size={17} />
              <span className="moresheet-label">What Comtrade holds</span>
            </button>
          </li>

          <li>
            <button
              onClick={() => {
                onQuery()
                onCloseMore()
              }}
            >
              <Terminal size={17} />
              <span className="moresheet-label">Build a Comtrade query</span>
            </button>
          </li>

          <li>
            <button
              onClick={() => {
                onGuide()
                onCloseMore()
              }}
            >
              <BookOpen size={17} />
              <span className="moresheet-label">How to read this dashboard</span>
            </button>
          </li>
        </ul>

        {pinned.length > 0 && (
          <div className="moresheet-group">
            <div className="moresheet-head">
              <Pin size={12} />
              <span>Pinned</span>
            </div>

            <ul className="moresheet-codes">{pinned.map(entry)}</ul>
          </div>
        )}

        {recent.length > 0 && (
          <div className="moresheet-group">
            <div className="moresheet-head">
              <Clock size={12} />
              <span>Recent</span>
            </div>

            <ul className="moresheet-codes">{recent.slice(0, 10).map(entry)}</ul>
          </div>
        )}
      </Sheet>
    </>
  )
}
