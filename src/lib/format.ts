import { HS_PARENT_NAMES } from './hsnames.generated'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/* =========================================================== decimals
 *
 * How many decimal places the reader wants (the Decimals control beside
 * Year and Currency). Null is Auto, the default and the clean view: money
 * and quantities print as whole numbers ($61bn, $651mn, 2,139), except a
 * figure under 10 in its own unit, which keeps one place so it does not
 * mislead ($5.5tn, not $6tn); percentages keep one place (1.1%, 0.2%). A
 * number from MIN_PLACES (0: every figure whole, percentages too) to
 * MAX_PLACES replaces all of that with exactly that many places, everywhere
 * on screen at once, and stays as the reader moves between pages. Files
 * (Excel, CSV, JSON) are never affected: they carry full values, and their
 * labels use the *Fixed formatters below.
 */
export const MIN_PLACES = 0
export const MAX_PLACES = 6

const PLACES_KEY = 'hstat-decimals'

function readPlaces(): number | null {
  try {
    const raw = localStorage.getItem(PLACES_KEY)
    if (raw === null || raw === '' || raw === 'auto') return null
    const value = Number(raw)
    return Number.isInteger(value) && value >= MIN_PLACES && value <= MAX_PLACES ? value : null
  } catch {
    return null
  }
}

let chosenPlaces: number | null = readPlaces()

const placeListeners = new Set<() => void>()

export function decimalPlaces(): number | null {
  return chosenPlaces
}

export function setDecimalPlaces(value: number | null): void {
  const next =
    value === null
      ? null
      : Math.min(MAX_PLACES, Math.max(MIN_PLACES, Math.round(value)))

  if (next === chosenPlaces) return

  chosenPlaces = next

  try {
    localStorage.setItem(PLACES_KEY, next === null ? 'auto' : String(next))
  } catch {
    /* Private browsing: the choice lasts for this visit only. */
  }

  placeListeners.forEach(listener => listener())
}

export function subscribeDecimals(listener: () => void): () => void {
  placeListeners.add(listener)
  return () => {
    placeListeners.delete(listener)
  }
}

/* The places a figure prints at: the reader's choice, else its own.
 * For figures that are neither money nor a percentage - an index, an
 * exchange rate, a multiple - whose own precision is part of their meaning. */
export function places(own: number): number {
  /* 0 is for values ("every figure whole"); an HHI of 0.214 printed as 0
   * would be wrong, not clean, so these keep their own precision there. */
  if (chosenPlaces === null || chosenPlaces === 0) return own
  return chosenPlaces
}

/*
 * Auto keeps a decimal only where it says something. `limit` is the size,
 * in the unit printed, below which one place is worth showing (10 for money,
 * no limit for percentages). The place is dropped when it would read .0
 * ($6.0tn is $6tn, 98.0% is 98%), and kept when the figure is non-zero but
 * rounds to 0.0, so the floor reads "<0.1" rather than "<1".
 */
function smartPlaces(size: number, shift: number, limit: number): number {
  const magnitude = Math.abs(size)

  if (magnitude === 0 || !Number.isFinite(magnitude)) return 0

  const one = fixed(magnitude, 1, shift)

  if (Number(one) === 0) return 1
  if (Number(one) >= limit) return 0

  return one.endsWith('.0') ? 0 : 1
}

/* Percentages: the reader's choice, else Auto - one place where it is not
 * .0. `shift` is 2 for a share (0.214 -> 21.4%), 0 for a figure already in
 * percent. */
export function pctPlaces(value: number, shift = 2): number {
  if (chosenPlaces !== null) return chosenPlaces

  return smartPlaces(value, shift, Infinity)
}

/*
 * Money and quantities: the reader's choice, else Auto - whole numbers, with
 * one place while the figure, in the unit it prints in, is under 10 and the
 * place is not .0. `shift` is the power of ten that unit takes (-9 for bn);
 * the test is made on the rounded figure, so 9.96bn prints "$10bn".
 */
export function valuePlaces(size: number, shift = 0): number {
  if (chosenPlaces !== null) return chosenPlaces

  return smartPlaces(size, shift, 10)
}

/*
 * Round half away from zero, on the decimal the reader sees.
 *
 * Number#toFixed rounds the binary value, so 1.005 prints "1.00" and 2.675
 * prints "2.67". A conversion tool says 1.01 and 2.68. The number is taken
 * as its shortest decimal string (what JavaScript prints for it), the point
 * is moved in that string - not by multiplying, which reintroduces the
 * error - and only then is it rounded. `shift` scales by a power of ten the
 * same way (2 turns a share into a percentage).
 */
export function fixed(value: number, digits: number, shift = 0): string {
  if (!Number.isFinite(value)) return '—'

  const d = Math.min(20, Math.max(0, Math.floor(digits)))
  const negative = value < 0

  const [mantissa, exponent = '0'] = String(Math.abs(value)).split('e')
  const shifted = Number(`${mantissa}e${Number(exponent) + shift + d}`)
  const rounded = Math.round(shifted)
  const back = Number(`${rounded}e${-d}`)

  const text = back.toFixed(d)

  return negative && back !== 0 ? `-${text}` : text
}

/* Thousands separators on a fixed-point string: 12345.6 -> "12,345.6". */
function western(text: string): string {
  const negative = text.startsWith('-')
  const [whole, fraction] = (negative ? text.slice(1) : text).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `${negative ? '-' : ''}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`
}

/* A plain number at the given places, grouped: tables of USD mn, crore. */
export function grouped(value: number, digits: number): string {
  return western(fixed(value, digits))
}

/* "<0.1" style floor, for a non-zero figure that would round to nothing. */
function floorText(digits: number): string {
  return digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`
}

/*
 * A share as a percentage, with a floor so a line that did trade is never
 * printed as 0%: "<0.1%" at one place, "<0.001%" at three.
 */
export function shareText(share: number | null | undefined, own = 1): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return '—'

  /* `own` is kept for callers; on screen a share follows pctPlaces. */
  void own
  const d = pctPlaces(share)

  if (share > 0 && Number(fixed(share, d, 2)) === 0) return `<${floorText(d)}%`

  return `${fixed(share, d, 2)}%`
}

type Pick = (size: number, shift: number) => number

function usdAt(value: number | null | undefined, pick: Pick): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  const size = Math.abs(value)

  /* Sign outside the symbol: -$1.88bn, not $-1.88bn. */
  const sign = value < 0 ? '-' : ''

  if (size >= 1e12) return `${sign}$${fixed(size, pick(size, -12), -12)}tn`
  if (size >= 1e9) return `${sign}$${fixed(size, pick(size, -9), -9)}bn`
  if (size >= 1e6) return `${sign}$${fixed(size, pick(size, -6), -6)}mn`
  if (size >= 1e3) return `${sign}$${fixed(size, pick(size, -3), -3)}k`

  return `${sign}$${fixed(size, pick(size, 0))}`
}

/* `digits` is the designed precision, used by files; the screen follows
 * valuePlaces. */
export function usd(value: number | null | undefined, digits = 2): string {
  void digits
  return usdAt(value, valuePlaces)
}

/* For files: always the designed precision, whatever the screen shows. */
export function usdFixed(value: number | null | undefined, digits = 2): string {
  return usdAt(value, (_size, shift) => (shift === 0 ? 0 : digits))
}

const CRORE = 1e7
const LAKH_CRORE = 1e12

/* Indian digit grouping: 1,23,45,678 rather than 12,345,678. Whole by
 * default; at the reader's chosen places when there is one. */
function indianGroups(value: number, digits = 0): string {
  const [whole, fraction] = fixed(Math.abs(value), digits).split('.')

  const tailText = fraction !== undefined ? `.${fraction}` : ''

  if (whole.length <= 3) return `${whole}${tailText}`

  const head = whole.slice(0, -3)
  const tail = whole.slice(-3)

  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}${tailText}`
}

/*
 * Rupees, in the units Indian policy documents actually use.
 *
 * Lakh crore is the headline unit, but a tariff line is routinely three or
 * four orders of magnitude below a sector total, and "₹ 0.00 lakh crore" is
 * not a number anyone can read. So the unit steps down with the magnitude
 * and is always printed, never assumed.
 */
export function inr(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  const size = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  void digits

  if (size >= LAKH_CRORE) {
    return `${sign}₹${fixed(size, valuePlaces(size, -12), -12)} lakh cr`
  }

  if (size >= CRORE) {
    return `${sign}₹${indianGroups(size / CRORE, valuePlaces(size, -7))} cr`
  }

  if (size >= 1e5) {
    return `${sign}₹${fixed(size, valuePlaces(size, -5), -5)} lakh`
  }

  return `${sign}₹${indianGroups(size, valuePlaces(size))}`
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  void digits
  return `${fixed(value, pctPlaces(value), 2)}%`
}

export function pctFixed(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  return `${fixed(value, digits, 2)}%`
}

/* Signed percentage, for growth and gaps where direction is the point. */
export function delta(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  void digits
  const text = fixed(value, pctPlaces(value), 2)

  return `${value >= 0 && !text.startsWith('-') ? '+' : ''}${text}%`
}

export function ordinal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  const remainder = value % 100

  if (remainder >= 11 && remainder <= 13) return `${value}th`

  switch (value % 10) {
    case 1: return `${value}st`
    case 2: return `${value}nd`
    case 3: return `${value}rd`
    default: return `${value}th`
  }
}

/*
 * A calendar day, one way everywhere: "8 Oct 2026". Takes an ISO date or
 * timestamp and reads its date part as written, so a UTC timestamp is not
 * shifted to the day before west of Greenwich.
 */
export function dayLabel(value: string | Date | null | undefined): string {
  if (!value) return '—'

  const iso = value instanceof Date ? value.toISOString() : String(value)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!m) return iso

  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/* "202406" -> "Jun 2024" */
export function monthLabel(period: string): string {
  if (!/^\d{6}$/.test(period)) return period

  const month = Number(period.slice(4)) - 1

  return `${MONTHS[month] ?? period.slice(4)} ${period.slice(0, 4)}`
}

/* "202406" -> "Jun" for dense axes. */
export function monthShort(period: string): string {
  if (!/^\d{6}$/.test(period)) return period

  const month = Number(period.slice(4)) - 1

  const label = MONTHS[month] ?? period.slice(4)

  return month === 0 ? `${label} ${period.slice(0, 4)}` : label
}

export function concentrationLabel(hhi: number | null): string {
  if (hhi === null || !Number.isFinite(hhi)) return 'Unknown'

  if (hhi >= 0.25) return 'High'
  if (hhi >= 0.15) return 'Moderate'

  return 'Low'
}

/*
 * The name to put in front of a reader.
 *
 * `displayName` is authored per HS-6 against the official text and is unique
 * across the catalogue. HS-2 chapters and HS-4 headings take their curated
 * short name (config/hs_short_names.csv) - the snapshot's `product` field for
 * a parent is a list of its first few members, never a name for it. `product`
 * is otherwise the family a code sits in and deliberately coarser, so it is
 * only a fallback, and the official description is the last resort.
 */
export function nameOf(
  item: {
    code?: string | null
    displayName?: string | null
    product?: string | null
    description?: string | null
  } | null
  | undefined,
): string {
  if (!item) return ''

  const parent = item.code && (item.code.length === 2 || item.code.length === 4)
    ? HS_PARENT_NAMES[item.code]
    : undefined

  if (parent && !item.displayName) return parent[0]

  return item.displayName || item.product || item.description || ''
}

/* The full official HS text for a code: a chapter's or heading's from the
 * HS titles table, a product's from its own description. Shown on hover. */
export function officialName(
  item: { code?: string | null; description?: string | null } | null | undefined,
): string {
  if (!item) return ''

  if (item.code && (item.code.length === 2 || item.code.length === 4)) {
    return HS_PARENT_NAMES[item.code]?.[1] ?? ''
  }

  return item.description ?? ''
}

/*
 * "1 economies" is the kind of thing a reader notices and then stops trusting
 * the rest of the number. One helper, used wherever a count meets a noun.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
