const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function usd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  const size = Math.abs(value)

  /* Sign outside the symbol: -$1.88bn, not $-1.88bn. */
  const sign = value < 0 ? '-' : ''

  if (size >= 1e12) return `${sign}$${(size / 1e12).toFixed(digits)}tn`
  if (size >= 1e9) return `${sign}$${(size / 1e9).toFixed(digits)}bn`
  if (size >= 1e6) return `${sign}$${(size / 1e6).toFixed(digits)}mn`
  if (size >= 1e3) return `${sign}$${(size / 1e3).toFixed(digits)}k`

  return `${sign}$${size.toFixed(0)}`
}

const CRORE = 1e7
const LAKH_CRORE = 1e12

/* Indian digit grouping: 1,23,45,678 rather than 12,345,678. */
function indianGroups(value: number): string {
  const rounded = Math.round(Math.abs(value)).toString()

  if (rounded.length <= 3) return rounded

  const head = rounded.slice(0, -3)
  const tail = rounded.slice(-3)

  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`
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

  if (size >= LAKH_CRORE) {
    return `${sign}₹${(size / LAKH_CRORE).toFixed(digits)} lakh cr`
  }

  if (size >= CRORE) {
    return `${sign}₹${indianGroups(size / CRORE)} cr`
  }

  if (size >= 1e5) {
    return `${sign}₹${(size / 1e5).toFixed(digits)} lakh`
  }

  return `${sign}₹${indianGroups(size)}`
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  return `${(value * 100).toFixed(digits)}%`
}

/* Signed percentage, for growth and gaps where direction is the point. */
export function delta(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
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
