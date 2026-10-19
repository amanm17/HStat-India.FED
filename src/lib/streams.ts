/*
 * Streams: which figures a code counts toward.
 *
 * HStat's coverage grows beyond electronics (materials, tools and machinery
 * for making electronics; wider trade lines). Those lines get their own
 * pages, but they must never move an electronics figure. Every code carries
 * a stream, set in hs_index/codes.csv:
 *
 *   electronics         the FED electronics definition. The only stream the
 *                       front page's totals, shares, rankings and segments
 *                       and the DGCIS panel ever sum.
 *   electronics-inputs  materials, consumables, tooling and machinery used
 *                       to make electronics (SPECS-type coverage)
 *   other               wider trade coverage, no electronics role claimed
 *
 * A snapshot or tariff file built before streams existed held electronics
 * only, so a missing stream reads as electronics.
 */

export type Stream = 'electronics' | 'electronics-inputs' | 'other'

export const STREAMS: Stream[] = ['electronics', 'electronics-inputs', 'other']

export function streamOf(item: { stream?: string | null } | null | undefined): Stream {
  const value = item?.stream

  /* Missing: a file from before streams, which held electronics only. */
  if (value === undefined || value === null || value === '') return 'electronics'
  if (value === 'electronics' || value === 'electronics-inputs') return value

  /* Anything else is never counted as electronics. */
  return 'other'
}

export function isElectronics(item: { stream?: string | null } | null | undefined): boolean {
  return streamOf(item) === 'electronics'
}

export const STREAM_LABEL: Record<Stream, string> = {
  electronics: 'Electronics',
  'electronics-inputs': 'Electronics inputs',
  other: 'Other trade',
}

/* One line on what a stream is, for notes and help cards. */
export const STREAM_NOTE: Record<Stream, string> = {
  electronics: 'The FED electronics definition: the only lines in the electronics figures.',
  'electronics-inputs':
    'Materials, tools and machinery used to make electronics. Own pages and totals; not in the electronics figures.',
  other: 'Wider trade coverage. Own pages; not in the electronics figures.',
}

/* The badge a page or result carries when it is not electronics. */
export function streamBadge(item: { stream?: string | null } | null | undefined): string | null {
  const stream = streamOf(item)

  return stream === 'electronics' ? null : `${STREAM_LABEL[stream]}, not in electronics totals`
}
