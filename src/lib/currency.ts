import type { CurrencyBlock, CurrencyMode, RateEntry } from '../types'
import { fixed, inr, places, usd } from './format'

/*
 * Converting a displayed figure to rupees.
 *
 * A period converts at its own rate where one exists. Where one does not,
 * a substitute is taken in a fixed order (execution prompt §1.9):
 *
 *   1. a missing month takes that calendar year's average rate;
 *   2. failing that, the financial-year average covering the month;
 *   3. failing that, the nearest available period's rate.
 *
 * A substituted rate is not an estimate and carries no asterisk, but it is
 * never silent either: the entry comes back with `substitute` set, and the
 * rate note under a converted figure names the period whose rate was used.
 * No rate is ever derived from DGCIS INR-crore / USD-million pairs.
 *
 * Scope is deliberately narrow. India's own figures and the tariff-line detail
 * convert; global trade, economy rankings and partner tables do not. An RBI
 * reference rate is the right way to read an Indian customs filing and the
 * wrong way to read anyone else's.
 */

export type Basis = 'CY' | 'FY' | 'MONTH'

export type Converted = {
  text: string
  /* False when no rate exists, so the caller can say why it stayed in USD. */
  converted: boolean
  rate: number | null
  source: string | null
}

/* "202406" and "2024-06" both name the same month. */
function canonicalMonth(period: string): string {
  return /^\d{6}$/.test(period)
    ? `${period.slice(0, 4)}-${period.slice(4)}`
    : period
}

export function basisOf(period: string): Basis | null {
  const text = String(period ?? '').trim()

  if (/^(19|20)\d{2}$/.test(text)) return 'CY'
  if (/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(text)) return 'MONTH'
  if (/^(19|20)\d{2}\d{2}$/.test(text)) return 'MONTH'
  if (/^(19|20)\d{2}-\d{2}$/.test(text)) return 'FY'

  return null
}

/*
 * Rates shipped with the frontend, merged in beneath the snapshot's own.
 *
 * The snapshot wins where it has an opinion, because its published figures
 * were validated against exactly those rates. Everywhere else - which today
 * is most periods, until the data is next rebuilt - the table that ships with
 * the build answers, so the toggle works the moment the site does.
 */
let fallbackRates: Record<string, Record<string, RateEntry>> = {}

export function useFallbackRates(
  rates: Record<string, Record<string, RateEntry>> | null | undefined,
): void {
  fallbackRates = rates ?? {}
}

export type ResolvedRate = RateEntry & {
  /* Set when the period had no rate of its own: the label of the period
   * whose rate stands in for it, e.g. "CY 2025". */
  substitute?: string
}

function own(
  currency: CurrencyBlock | undefined,
  basis: Basis,
  key: string,
): RateEntry | null {
  return currency?.rates?.[basis]?.[key] ?? fallbackRates[basis]?.[key] ?? null
}

function keysOf(currency: CurrencyBlock | undefined, basis: Basis): string[] {
  return Array.from(
    new Set([
      ...Object.keys(currency?.rates?.[basis] ?? {}),
      ...Object.keys(fallbackRates[basis] ?? {}),
    ]),
  )
}

/* A comparable position on one time line, in months. FY "2024-25" sits at
 * its middle, October 2024; CY 2024 at its middle, July. */
function position(basis: Basis, key: string): number | null {
  if (basis === 'MONTH') {
    const match = /^(\d{4})-(\d{2})$/.exec(key)
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null
  }

  if (basis === 'CY') return /^\d{4}$/.test(key) ? Number(key) * 12 + 6 : null

  const match = /^(\d{4})-\d{2}$/.exec(key)
  return match ? Number(match[1]) * 12 + 9 : null
}

function fyOf(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

function nearest(
  currency: CurrencyBlock | undefined,
  at: number,
  prefer: Basis,
): { basis: Basis; key: string; entry: RateEntry } | null {
  let best: { basis: Basis; key: string; entry: RateEntry; gap: number; rank: number } | null = null
  const order: Basis[] = [prefer, ...(['MONTH', 'CY', 'FY'] as Basis[]).filter(item => item !== prefer)]

  for (const basis of order) {
    for (const key of keysOf(currency, basis)) {
      const where = position(basis, key)
      const entry = own(currency, basis, key)

      if (where === null || !entry) continue

      const gap = Math.abs(where - at)
      const rank = order.indexOf(basis)

      if (!best || gap < best.gap || (gap === best.gap && rank < best.rank)) {
        best = { basis, key, entry, gap, rank }
      }
    }
  }

  return best
}

export function rateFor(
  currency: CurrencyBlock | undefined,
  period: string,
  basis?: Basis,
): ResolvedRate | null {
  const resolved = basis ?? basisOf(period)

  if (!resolved) return null

  const key = resolved === 'MONTH' ? canonicalMonth(period) : period
  const exact = own(currency, resolved, key)

  if (exact) return exact

  const at = position(resolved, key)

  if (at === null) return null

  if (resolved === 'MONTH') {
    const year = Number(key.slice(0, 4))
    const month = Number(key.slice(5, 7))

    const calendar = own(currency, 'CY', String(year))
    if (calendar) return { ...calendar, substitute: `CY ${year}` }

    const fy = fyOf(year, month)
    const financial = own(currency, 'FY', fy)
    if (financial) return { ...financial, substitute: `FY ${fy}` }
  }

  if (resolved === 'FY') {
    const start = Number(key.slice(0, 4))
    const calendar = own(currency, 'CY', String(start))
    if (calendar) return { ...calendar, substitute: `CY ${start}` }
  }

  const found = nearest(currency, at, resolved)

  return found
    ? { ...found.entry, substitute: periodLabel(found.key, found.basis) }
    : null
}

/* How many of the periods a page needs can actually be converted. Used for
 * the one-line "no rates at all" notice, which should only ever appear when
 * both the snapshot and the shipped table are empty. */
export function convertibleCount(
  currency: CurrencyBlock | undefined,
  periods: { period: string; basis: Basis }[],
): number {
  return periods.filter(item => rateFor(currency, item.period, item.basis))
    .length
}

/*
 * Format one US-dollar figure in the requested currency.
 *
 * `nativeInr` short-circuits the conversion for values the source published in
 * rupees: those are shown exactly as filed rather than round-tripped through a
 * rate, so the number on the page is the number DGCIS printed.
 */
export function money(
  value: number | null | undefined,
  mode: CurrencyMode,
  currency: CurrencyBlock | undefined,
  period: string,
  options?: { basis?: Basis; nativeInr?: number | null },
): Converted {
  if (mode === 'USD') {
    return { text: usd(value), converted: false, rate: null, source: null }
  }

  const entry = rateFor(currency, period, options?.basis)

  if (options?.nativeInr !== null && options?.nativeInr !== undefined) {
    return {
      text: inr(options.nativeInr),
      converted: false,
      rate: entry?.rate ?? null,
      source: 'as filed',
    }
  }

  if (!entry || value === null || value === undefined) {
    return {
      text: usd(value),
      converted: false,
      rate: null,
      source: null,
    }
  }

  return {
    text: inr(value * entry.rate),
    converted: true,
    rate: entry.rate,
    source: entry.source,
  }
}

/* The short label under a converted figure: what rate, for what period. */
export function rateNote(
  mode: CurrencyMode,
  currency: CurrencyBlock | undefined,
  period: string,
  basis?: Basis,
): string | null {
  if (mode !== 'INR') return null

  const entry = rateFor(currency, period, basis)

  if (!entry) {
    return `No ${periodLabel(period, basis)} rate — shown in US dollars`
  }

  if (entry.substitute) {
    return `Converted at ₹${fixed(entry.rate, places(2))}/$ (${entry.substitute} average; no ${periodLabel(period, basis)} rate)`
  }

  return `Converted at ₹${fixed(entry.rate, places(2))}/$ (${periodLabel(period, basis)} average)`
}

export function periodLabel(period: string, basis?: Basis): string {
  const resolved = basis ?? basisOf(period)

  if (resolved === 'FY') return `FY ${period}`
  if (resolved === 'CY') return `CY ${period}`

  return canonicalMonth(period)
}

/*
 * The financial year to show beside a calendar year.
 *
 * Preference is the financial year that starts inside it — CY 2024 pairs with
 * FY 2024-25, which shares nine of its twelve months. But a part year is not a
 * fair thing to make the default view, so if that financial year is not fully
 * built out the previous one is offered instead and the page says which it
 * picked. An explicit choice by the reader always wins over both.
 */
export function defaultFinancialYear(
  available: string[],
  calendarYear: number,
  isComplete: (fy: string) => boolean,
): string | null {
  if (!available.length) return null

  const preferred = `${calendarYear}-${String(calendarYear + 1).slice(-2)}`

  if (available.includes(preferred) && isComplete(preferred)) return preferred

  const previous = `${calendarYear - 1}-${String(calendarYear).slice(-2)}`

  if (available.includes(previous) && isComplete(previous)) return previous

  const complete = available.filter(isComplete)

  if (complete.length) return complete[complete.length - 1]

  if (available.includes(preferred)) return preferred

  return available[available.length - 1]
}
