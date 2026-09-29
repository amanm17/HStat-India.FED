import { useEffect, useState } from 'react'

/*
 * Which shape of screen is this?
 *
 * Two breakpoints, each named for what it decides rather than for a device:
 *
 *   NO_RAIL   the left rail no longer fits, so something else has to carry
 *             navigation. This is where the bottom tab bar appears; it is the
 *             rail's stand-in, not an extra.
 *
 *   PHONE     a column narrow enough that a table stops being a table and a
 *             drag handle stops being usable. Cards, sheets, bigger targets.
 *
 * 900 is where .navrail already hid itself, so the tab bar takes over exactly
 * where the rail gives up and there is never a width with no way to navigate.
 * 640 is where a four-column table has under 90px a column, which is not a
 * table any more, it is a puzzle.
 *
 * Both listen to matchMedia rather than to resize: a phone rotating fires one
 * change, not forty, and the browser has already done the work.
 */
export const NO_RAIL = '(max-width: 900px)'
export const PHONE = '(max-width: 640px)'

/* Coarse pointer and no hover is the honest test for "a finger", and it is
 * what decides whether a drag handle or a hover-reveal can be relied on. A
 * narrow laptop window is not a touchscreen and should not be treated as one. */
export const TOUCH = '(hover: none) and (pointer: coarse)'

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false

    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (!window.matchMedia) return

    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)

    setMatches(list.matches)
    list.addEventListener('change', onChange)

    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export function usePhone(): boolean {
  return useMedia(PHONE)
}

export function useNoRail(): boolean {
  return useMedia(NO_RAIL)
}

export function useTouch(): boolean {
  return useMedia(TOUCH)
}
