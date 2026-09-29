import { useEffect } from 'react'

/*
 * Slash to search.
 *
 * The box already treated a leading "/" as the switch into commands, but only
 * once your cursor was in it - so the shortcut everybody's fingers already
 * know did nothing until you had done the thing the shortcut was meant to
 * save you. On a product page that meant reaching for the mouse, finding a
 * 300px box in the title strip, clicking it, and only then typing.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not steal the key from anyone typing. A search field, a report
 * name, a filter box and a contenteditable are all places where "/" is a
 * character, and a shortcut that eats one is worse than no shortcut. Nor does
 * it fire with a modifier held: ctrl+/ and cmd+/ belong to the browser and to
 * whatever the reader has bound them to.
 *
 * WHY IT FOCUSES RATHER THAN PRE-FILLING
 *
 * Pressing "/" could have put a "/" in the box and opened the command list
 * directly. It focuses an empty box instead, because "/" means "let me type"
 * everywhere else on the web - GitHub, Slack, Linear - and because a reader
 * who wanted commands types the slash again, which is exactly the gesture the
 * box already documents. Search is the common case; commands are one more
 * keystroke, and that keystroke is the one already advertised.
 */
export function useSlashToSearch(open: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      const target = event.target as HTMLElement | null

      if (target) {
        const tag = target.tagName

        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }

      /* Only now, once we know we are going to act on it - otherwise a "/"
       * typed into a field would vanish. */
      event.preventDefault()
      open()
    }

    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [open])
}

/*
 * Where the box is, on whichever page this is.
 *
 * The front page has the hub in the middle of the screen and every other page
 * has the bar in the title strip; only one of the two is ever mounted, so the
 * first match is the right one. Selecting the existing text means a second
 * press starts a fresh query rather than appending to a stale one.
 */
export function focusSearchBox(): boolean {
  const input = document.querySelector<HTMLInputElement>('.search-hub input')

  if (!input) return false

  input.focus()
  input.select()

  return true
}
