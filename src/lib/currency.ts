import type { CurrencyBlock, CurrencyMode, RateEntry } from '../types'
import { inr, usd } from './format'

/*
 * Converting a displayed figure to rupees.
 *
 * The rule the pipeline enforces and this mirrors: a period converts at its
 * own rate, or it does not convert at all. There is no nearest-year fallback
 * here either, because a rupee figure produced from the wrong year's rate is
 * indistinguishable on the page from one produced from the right year's.
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

export function rateFor(
  currency: CurrencyBlock | undefined,
  period: string,
  basis?: Basis,
): RateEntry | null {
  const resolved = basis ?? basisOf(period)

  if (!resolved) return null

  const key = resolved === 'MONTH' ? canonicalMonth(period) : period

  return (
    currency?.rates?.[resolved]?.[key] ??
    fallbackRates[resolved]?.[key] ??
    null
  )
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

  return `Converted at ₹${entry.rate.toFixed(2)}/$ (${periodLabel(period, basis)} average)`
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
