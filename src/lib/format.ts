const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/* =========================================================== decimals
 *
 * How many decimal places the reader wants (the Decimals control beside
 * Year and Currency). Null is "Auto": every figure keeps the precision it
 * was designed with - $61.48bn, 2.2%, 2,139 USD mn. A number replaces all
 * of those with that many places, everywhere on screen at once, and stays
 * as the reader moves between pages. Files (Excel, CSV, JSON) are never
 * affected: they carry full values, and their labels use the *Fixed
 * formatters below.
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

/* The places a figure prints at: the reader's choice, else its own. */
export function places(own: number): number {
  return chosenPlaces ?? own
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

/* A plain number at the chosen places, grouped: tables of USD mn, crore. */
export function grouped(value: number, own: number): string {
  return western(fixed(value, places(own)))
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

  const d = places(own)

  if (share > 0 && Number(fixed(share, d, 2)) === 0) return `<${floorText(d)}%`

  return `${fixed(share, d, 2)}%`
}

function usdAt(value: number | null | undefined, d: number, small: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  const size = Math.abs(value)

  /* Sign outside the symbol: -$1.88bn, not $-1.88bn. */
  const sign = value < 0 ? '-' : ''

  if (size >= 1e12) return `${sign}$${fixed(size, d, -12)}tn`
  if (size >= 1e9) return `${sign}$${fixed(size, d, -9)}bn`
  if (size >= 1e6) return `${sign}$${fixed(size, d, -6)}mn`
  if (size >= 1e3) return `${sign}$${fixed(size, d, -3)}k`

  return `${sign}$${fixed(size, small)}`
}

export function usd(value: number | null | undefined, digits = 2): string {
  return usdAt(value, places(digits), places(0))
}

/* For files: always the designed precision, whatever the screen shows. */
export function usdFixed(value: number | null | undefined, digits = 2): string {
  return usdAt(value, digits, 0)
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

  const d = places(digits)
  const whole = places(0)

  if (size >= LAKH_CRORE) {
    return `${sign}₹${fixed(size, d, -12)} lakh cr`
  }

  if (size >= CRORE) {
    return `${sign}₹${indianGroups(size / CRORE, whole)} cr`
  }

  if (size >= 1e5) {
    return `${sign}₹${fixed(size, d, -5)} lakh`
  }

  return `${sign}₹${indianGroups(size, whole)}`
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  return `${fixed(value, places(digits), 2)}%`
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

  const text = fixed(value, places(digits), 2)

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
 * across the catalogue. `product` is the family it sits in and is deliberately
 * coarser - eight codes under 8544 are all "Cables", which is right for the
 * heading and useless for any code inside it - so it is only a fallback, and
 * the official description is the last resort. Parents have no display name
 * and fall through to their heading title.
 */
export function nameOf(
  item: {
    displayName?: string | null
    product?: string | null
    description?: string | null
  } | null
  | undefined,
): string {
  if (!item) return ''

  return item.displayName || item.product || item.description || ''
}

/*
 * "1 economies" is the kind of thing a reader notices and then stops trusting
 * the rest of the number. One helper, used wherever a count meets a noun.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
