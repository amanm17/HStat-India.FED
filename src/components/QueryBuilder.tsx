import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'

import type { CatalogueEntry } from '../types'
import { comtradeQueryUrl, INDIA_REPORTER, type ComtradeFlow } from '../lib/comtrade'

/*
 * Build a Comtrade query without knowing Comtrade.
 *
 * The hard part of pulling trade data is never running the call - it is
 * composing a correct one. This project got the parameters wrong four times
 * before a working URL was pasted in by hand, and that was with the
 * documentation open. A form that knows our 418 products by name, and that
 * emits the exact call three ways, removes the part people actually get wrong.
 *
 * NO KEY IS HANDLED HERE, DELIBERATELY.
 *
 * HStat is static files on Cloudflare: there is no server to run a query on,
 * and the browser cannot call Comtrade itself because Comtrade refuses
 * cross-origin requests. Accepting a subscription key would therefore mean
 * building a backend and passing someone's credential through it - a decision
 * with real consequences that belongs to whoever runs this dashboard, not to
 * whoever built this page. So this composes the query and hands it over; you
 * run it where your key already lives.
 */
const FLOWS: { code: ComtradeFlow; label: string }[] = [
  { code: 'M', label: 'Imports' },
  { code: 'X', label: 'Exports' },
  { code: 'RM', label: 'Re-imports' },
  { code: 'RX', label: 'Re-exports' },
]

function Copyable({ label, value, note }: { label: string; value: string; note?: string }) {
  const [done, setDone] = useState(false)

  return (
    <div className="qb-out">
      <div className="qb-out-head">
        <strong>{label}</strong>

        <button
          className="linkish"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setDone(true)
              window.setTimeout(() => setDone(false), 1600)
            } catch {
              /* Clipboard refused (insecure context, permissions). The text is
               * on screen and selectable, so this is not worth an alert. */
            }
          }}
        >
          {done ? <><Check size={12} /> copied</> : <><Copy size={12} /> copy</>}
        </button>
      </div>

      <pre>{value}</pre>

      {note && <p className="qb-note">{note}</p>}
    </div>
  )
}

export function QueryBuilder({
  catalogue,
  onHome,
}: {
  catalogue: CatalogueEntry[]
  onHome: () => void
}) {
  const products = useMemo(
    () => catalogue.filter(entry => entry.level === 6),
    [catalogue],
  )

  const [code, setCode] = useState('851713')
  const [flow, setFlow] = useState<ComtradeFlow>('M')
  const [year, setYear] = useState(String(new Date().getFullYear() - 1))
  const [reporter, setReporter] = useState<'all' | 'india'>('all')
  const [freq, setFreq] = useState<'A' | 'M'>('A')
  const [filter, setFilter] = useState('')

  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase()

    if (!text) return products.slice(0, 200)

    return products
      .filter(entry =>
        entry.code.startsWith(text.replace(/\D/g, '')) ||
        (entry.displayName ?? '').toLowerCase().includes(text) ||
        entry.product.toLowerCase().includes(text) ||
        entry.description.toLowerCase().includes(text))
      .slice(0, 200)
  }, [products, filter])

  const chosen = products.find(entry => entry.code === code)

  const period = freq === 'A' ? year : `${year}01`

  const pageUrl = comtradeQueryUrl({
    code,
    year: Number(year),
    flow,
    reporter: reporter === 'india' ? INDIA_REPORTER : 'all',
  })

  const previewUrl =
    `https://comtradeapi.un.org/public/v1/preview/C/${freq}/HS` +
    `?reporterCode=${reporter === 'india' ? INDIA_REPORTER : ''}` +
    `&period=${period}&cmdCode=${code}&flowCode=${flow}` +
    `&partnerCode=0&partner2Code=0&customsCode=C00&motCode=0` +
    `&includeDesc=True&maxRecords=500`

  const snippet = [
    'import comtradeapicall',
    '',
    "subscription_key = '<YOUR KEY>'   # comtradedeveloper.un.org",
    '',
    'df = comtradeapicall.getFinalData(',
    '    subscription_key,',
    "    typeCode='C',",
    `    freqCode='${freq}',`,
    "    clCode='HS',",
    `    period='${period}',`,
    `    reporterCode=${reporter === 'india' ? `'${INDIA_REPORTER}'` : 'None'},`,
    `    cmdCode='${code}',`,
    `    flowCode='${flow}',`,
    "    partnerCode=0,",
    "    partner2Code=0,",
    "    customsCode='C00',",
    "    motCode=0,",
    '    maxRecords=250000,',
    "    format_output='JSON',",
    "    breakdownMode='classic',",
    '    includeDesc=True,',
    ')',
    '',
    'df.head()',
  ].join('\n')

  return (
    <div className="qb-page">
      <div className="eyebrow">BUILD A COMTRADE QUERY</div>

      <h1>Build a Comtrade query</h1>

      <p className="qb-lede">
        Pick a product by name rather than by code, and this writes the query
        three ways: a link that opens Comtrade's own results page, a keyless API
        URL good for 500 rows, and a Python snippet for your own key. Nothing is
        sent anywhere from here, and no key is asked for — see the note at the
        foot.
      </p>

      <div className="qb-form">
        <label className="qb-field qb-wide">
          <span>Product</span>

          <input
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Filter by name or code — smartphone, 8517…"
          />

          <select value={code} onChange={event => setCode(event.target.value)} size={1}>
            {shown.map(entry => (
              <option key={entry.code} value={entry.code}>
                {entry.code} — {entry.displayName || entry.product}
              </option>
            ))}
          </select>
        </label>

        <label className="qb-field">
          <span>Flow</span>
          <select value={flow} onChange={event => setFlow(event.target.value as ComtradeFlow)}>
            {FLOWS.map(item => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="qb-field">
          <span>Reporter</span>
          <select
            value={reporter}
            onChange={event => setReporter(event.target.value as 'all' | 'india')}
          >
            <option value="all">All economies</option>
            <option value="india">India only</option>
          </select>
        </label>

        <label className="qb-field">
          <span>Frequency</span>
          <select value={freq} onChange={event => setFreq(event.target.value as 'A' | 'M')}>
            <option value="A">Annual</option>
            <option value="M">Monthly</option>
          </select>
        </label>

        <label className="qb-field">
          <span>{freq === 'A' ? 'Year' : 'Year (January)'}</span>
          <input
            value={year}
            inputMode="numeric"
            onChange={event => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </label>
      </div>

      {chosen && (
        <p className="qb-chosen">
          <strong>HS {chosen.code}</strong> — {chosen.description}
        </p>
      )}

      <div className="qb-outs">
        <div className="qb-out">
          <div className="qb-out-head">
            <strong>Open Comtrade's results page</strong>

            <a className="linkish" href={pageUrl} target="_blank" rel="noreferrer">
              open <ExternalLink size={12} />
            </a>
          </div>

          <pre>{pageUrl}</pre>

          <p className="qb-note">
            Everything selected already. Free Comtrade accounts hit a captcha on
            each search unless registered; registration is free and removes it.
          </p>
        </div>

        <Copyable
          label="Keyless API URL"
          value={previewUrl}
          note="Comtrade's public preview tier: no key, capped at 500 records, JSON only. Paste into a browser or curl."
        />

        <Copyable
          label="Python, with your own key"
          value={snippet}
          note="Needs comtradeapicall (pip install comtradeapicall) and a key from comtradedeveloper.un.org. Up to 250,000 records."
        />
      </div>

      <section className="qb-why">
        <h2>Why there is no key field</h2>

        <p>
          HStat is static files — there is no server here to run a query on, and
          the browser cannot call Comtrade directly because Comtrade refuses
          cross-origin requests. Accepting a key would mean building a backend
          and passing your credential through it, which brings real decisions
          with it: the key would transit that server on every query, the
          endpoint would be public and usable by anyone as a Comtrade proxy, and
          it would need rate limiting to avoid being abused.
        </p>

        <p>
          That is a decision for whoever runs this dashboard, not a default to
          inherit. So this page composes the query — the part that is genuinely
          fiddly — and you run it where your key already lives.
        </p>
      </section>

      <button className="linkish qb-home" onClick={onHome}>
        Back to the front page
      </button>
    </div>
  )
}
