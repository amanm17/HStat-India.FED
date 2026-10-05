/*
 * Where India stands, on each side of the trade, said out loud.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * The product page used to carry one "India rank" and one "India share",
 * with no word about what they measured. Both were import-side, because the
 * global figure this dashboard publishes is world imports. On smartphones
 * that produced:
 *
 *     India exports   $30.13bn
 *     India share      0.2%        Rank 47th
 *
 * An outside reviewer read those two lines together and concluded the data
 * was wrong. It was not. India bought $650mn of smartphones in 2025, which
 * is 47th in the world, and sold $30.13bn of them, which is first in the
 * world - 27.9% of everything exported. The page showed the first number and
 * stayed silent about the second, so the reader supplied the missing label
 * themselves, and got it wrong.
 *
 * A rank with no side is not a fact, it is half of one. Everything here
 * carries its side in the label.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * All four are already published per year; none is derived from a rounded
 * display figure:
 *
 *   import share   india.imports (net of re-imports) / global.observed.netImports
 *   import rank    global.indiaRank - computed over reporters at source
 *   export share   india.exportsNetReExports / global.observed.netExports
 *   export rank    India's row in global.topExporters
 *
 * The export rank is only known when India is inside the published top ten,
 * which is 62 of 418 products. Outside it the share is still exact and the
 * rank is reported honestly as unplaced, never guessed at.
 */

export type Side = {
  /* India's own trade on this side, in USD. */
  value: number | null
  /* India's share of the world total on this side, 0-1. */
  share: number | null
  /* India's position, when it is known. */
  rank: number | null
  /* True when India trades on this side but sits outside the published top
   * ten, so there is a share but no rank. */
  unplaced: boolean
}

export type Standing = {
  imports: Side
  exports: Side
}

/* The shape this reads, kept loose: the snapshot is typed in ../types, and
 * this helper is called with both the per-year record and the latest-year
 * summary, which carry the same fields under the same names. */
type AnnualLike = {
  india?: {
    imports?: number | null
    exports?: number | null
    importsNetReImports?: number | null
    exportsNetReExports?: number | null
  } | null
  global?: {
    indiaRank?: number | null
    indiaShare?: number | null
    observed?: {
      netImports?: number | null
      netExports?: number | null
    } | null
    topExporters?: { code?: string; rank?: number }[] | null
    trade?: number | null
  } | null
}

const INDIA = '699'

function ratio(part: number | null | undefined, whole: number | null | undefined) {
  if (part === null || part === undefined) return null
  if (!whole || !Number.isFinite(whole) || whole <= 0) return null

  return part / whole
}

export function standing(record: AnnualLike | null | undefined): Standing {
  const india = record?.india ?? {}
  const world = record?.global ?? {}
  const observed = world?.observed ?? {}

  const importValue = india.importsNetReImports ?? india.imports ?? null
  const exportValue = india.exportsNetReExports ?? india.exports ?? null

  /* The import share is computed at source over every reporter, so it is
   * preferred to anything recomputed here; the division is the fallback for
   * years that carry the totals but no rank row. */
  const importShare =
    world.indiaShare ?? ratio(importValue, observed.netImports)

  const exportShare = ratio(exportValue, observed.netExports)

  const exportRow = (world.topExporters ?? []).find(row => row?.code === INDIA)

  return {
    imports: {
      value: importValue,
      share: importShare ?? null,
      rank: world.indiaRank ?? null,
      unplaced: false,
    },
    exports: {
      value: exportValue,
      share: exportShare,
      rank: exportRow?.rank ?? null,
      /* Trading, counted, and outside the top ten - which is a fact about
       * where India sits, not an absence of one. */
      unplaced:
        !exportRow && exportShare !== null && (exportValue ?? 0) > 0,
    },
  }
}

/*
 * The one-line caption under a figure: "27.9% of world exports · 1st".
 *
 * Written so it can be read left to right without a legend. The share comes
 * first because it is the part a reader can act on; the rank is the headline
 * that needs the share beside it to mean anything, as 47th did.
 */
export function sideCaption(
  side: Side,
  flow: 'imports' | 'exports',
  pct: (value: number | null, digits?: number) => string,
  ordinal: (value: number | null) => string,
): string {
  const of = flow === 'imports' ? 'of world imports' : 'of world exports'

  if (side.share === null) return flow === 'imports' ? 'Imports' : 'Exports'

  const noun = flow === 'imports' ? 'importer' : 'exporter'

  /* "1st largest exporter" is not English. First place gets said properly. */
  const where =
    side.rank === 1
      ? `the world's largest ${noun}`
      : side.rank !== null
        ? `${ordinal(side.rank)} largest ${noun}`
        : side.unplaced
          ? 'outside the top ten'
          : ''

  return where ? `${pct(side.share, 1)} ${of} · ${where}` : `${pct(side.share, 1)} ${of}`
}
