import { useSyncExternalStore } from 'react'

/*
 * THE SECRET LOOK
 *
 * Two looks share one site. "fed" is the FED-branded design every reader
 * gets. "aman" is a modern take on the dashboard's original design language
 * (Inter, navy / blue / green, soft rounded cards), reached only by typing
 * a code into the search box:
 *
 *   ~AM1708     switch to HStat.India by Aman
 *   ~AM1708/    switch back to the FED design
 *
 * The choice is per browser (localStorage) and is presentation only: no
 * figure, label, file or download changes with it. Workbooks and reports
 * stay FED-branded in both looks, because they leave the site.
 *
 * The code fires on Enter, or once the box has held it unchanged for a
 * moment - so typing "~AM1708/" passes through "~AM1708" without
 * triggering it on the way.
 */

export type Look = 'fed' | 'aman'

export const LOOK_CODE = '~AM1708'
export const LOOK_EXIT = '~AM1708/'

const KEY = 'hstat-look'
const FONT_ID = 'hstat-aman-font'

let current: Look = 'fed'
const listeners = new Set<() => void>()

export function readLook(): Look {
  try {
    return window.localStorage.getItem(KEY) === 'aman' ? 'aman' : 'fed'
  } catch {
    return 'fed'
  }
}

/* Inter and JetBrains Mono, fetched only when someone opens the secret look. */
function loadFonts() {
  if (document.getElementById(FONT_ID)) return

  const link = document.createElement('link')

  link.id = FONT_ID
  link.rel = 'stylesheet'
  link.href =
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap'
  document.head.appendChild(link)
}

/* The pointer spotlight on cards (aman.css reads --mx/--my). One passive
 * listener for the whole page, doing nothing in the FED look. */
let spotlight = false

function installSpotlight() {
  if (spotlight) return

  spotlight = true

  window.addEventListener(
    'pointermove',
    event => {
      if (current !== 'aman' || event.pointerType !== 'mouse') return

      const card = (event.target as Element | null)?.closest?.('.rf-figure, .rf-cat') as HTMLElement | null

      if (!card) return

      const r = card.getBoundingClientRect()

      card.style.setProperty('--mx', `${event.clientX - r.left}px`)
      card.style.setProperty('--my', `${event.clientY - r.top}px`)
    },
    { passive: true },
  )
}

export function applyLook(look: Look) {
  current = look

  const root = document.documentElement

  if (look === 'aman') {
    loadFonts()
    installSpotlight()
    root.dataset.look = 'aman'
  } else {
    delete root.dataset.look
  }

  try {
    if (look === 'aman') window.localStorage.setItem(KEY, 'aman')
    else window.localStorage.removeItem(KEY)
  } catch {
    /* Private mode: the look still applies for this visit. */
  }

  listeners.forEach(listener => listener())
}

export function currentLook(): Look {
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function useLook(): Look {
  return useSyncExternalStore(subscribe, currentLook, () => 'fed')
}

/*
 * What a query means to the look, if anything. Anything starting with "~"
 * is kept out of search entirely, so a half-typed code never shows a "no
 * results" panel that would give the game away.
 */
export function lookCommand(query: string): Look | 'pending' | null {
  const text = query.trim()

  if (!text.startsWith('~')) return null
  if (text.toUpperCase() === LOOK_EXIT) return 'fed'
  if (text.toUpperCase() === LOOK_CODE) return 'aman'

  return 'pending'
}

/* Ask the transition layer to run; it applies the look at the right frame. */
export function requestLook(look: Look) {
  window.dispatchEvent(new CustomEvent<Look>('hstat:look', { detail: look }))
}
