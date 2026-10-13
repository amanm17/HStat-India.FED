import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'

import {
  loadAvailability,
  monthLabel,
  nextCheck,
  nextRefresh,
  refreshDue,
  type Availability as Data,
} from '../lib/availability'
import { dayLabel, plural, usd } from '../lib/format'
import { usePageHelp } from '../lib/pagehelp'
import { usePhone } from '../lib/viewport'
import { Rows } from './Rows'
import { PageHeader } from './ui'

/*
 * What Comtrade holds, and what it costs us.
 *
 * Comtrade publishes its own availability dashboard. This is not a copy of it:
 * theirs answers "who has filed", which is a fact about the UN's database, and
 * this answers "which of our pages are thin, and why", which is the question
 * anybody standing in front of HStat is actually asking.
 *
 * The join is the point. We know which reporter is missing from which of our
 * 418 products and what they were worth last year; Comtrade knows whether that
 * reporter has since filed. Put the two together and the page can say the one
 * useful thing: a refresh would fix this, or it would not.
 */
export function Availability({
  onOpen,
  onHome,
}: {
  onOpen?: (code: string, level: 2 | 4 | 6) => void
  onHome: () => void
}) {
  const [data, setData] = useState<Data | null | undefined>(undefined)
  const phone = usePhone()

  useEffect(() => {
    loadAvailability().then(result => setData(result))
  }, [])

  usePageHelp(
    () => ({
      facts: data
        ? [
            {
              label: 'Latest annual year',
              value: plural(data.annual[data.annual.length - 1]?.reporters ?? 0, 'economy', 'economies'),
              note: `have filed ${data.annual[data.annual.length - 1]?.period ?? '—'}`,
            },
            {
              label: 'Latest month',
              value: plural(data.monthly[data.monthly.length - 1]?.reporters ?? 0, 'economy', 'economies'),
              note: `have filed ${monthLabel(data.monthly[data.monthly.length - 1]?.period ?? '')}`,
            },
            {
              label: 'Gaps found',
              value: String(data.holes.length),
              note: `${data.holes.filter(hole => hole.filedSince).length} of them have filed since this snapshot was built`,
            },
            data.holes[0]
              ? {
                  label: 'Largest gap',
                  value: data.holes[0].reporter,
                  note: `${plural(data.holes[0].products, 'product')} of ours, worth ${usd(data.holes[0].priorValue, 1)} the year before`,
                }
              : null,
          ].filter((fact): fact is NonNullable<typeof fact> => fact !== null)
        : undefined,

      presented: data
        ? [
            { name: 'The banner', what: 'whether Comtrade has released anything since our last pull, and when it will be picked up' },
            { name: 'The dates', what: 'when Comtrade was last checked (the 1st of each month, and after every data refresh)' },
            { name: 'Annual coverage', what: 'how many economies filed each year' },
            { name: 'Monthly coverage', what: 'fresher, but far thinner' },
            { name: 'Who is missing', what: 'each absence, and what it was worth last year' },
          ]
        : [{ name: 'The command', what: 'what to run to fill this page' }],
    }),
    [data],
  )

  if (data === undefined) {
    return <div className="avail-page loading">Loading…</div>
  }

  /*
   * Never invented. If the fetch has not been run there is no file, and the
   * page says which command produces one rather than drawing an empty chart.
   */
  if (!data) {
    return (
      <div className="avail-page missing">
        <div className="eyebrow">UN COMTRADE · DATA AVAILABILITY</div>

        <h1>Coverage file not built yet</h1>

        <p>
          Comtrade&rsquo;s record of which economies filed which period, joined to the 418
          products. The pipeline fetches it, not your browser: Comtrade refuses
          cross-origin calls, and a page that phones a third party on every load
          inherits its downtime.
        </p>

        <pre className="avail-cmd">python3 pipeline/comtrade/fetch_availability.py</pre>

        <p className="avail-note">
          No key needed. Commit the file it writes and this page fills in.
        </p>

        <button className="linkish" onClick={onHome}>Back to the front page</button>
      </div>
    )
  }

  const due = refreshDue(data)
  const annual = [...data.annual].reverse()
  const monthly = [...data.monthly].reverse().slice(0, 12)
  const peak = Math.max(...data.annual.map(row => row.reporters), 1)


  return (
    <div className="avail-page">
      <PageHeader
        title="Data availability"
        sub="Which economies have filed with UN Comtrade, by year and month."
        aside={
          <a className="linkish avail-source" href={data.sourceUrl} target="_blank" rel="noreferrer">
            Comtrade&rsquo;s page <ExternalLink size={14} aria-hidden />
          </a>
        }
      />

      <dl className="avail-dates">
        <div>
          <dt>Checked with Comtrade</dt>
          <dd>{dayLabel(data.fetchedAt)}</dd>
        </div>
        <div>
          <dt>Our data pulled</dt>
          <dd>{dayLabel(due.pulled)}</dd>
        </div>
        <div>
          <dt>Next check</dt>
          <dd>{dayLabel(nextCheck())}</dd>
        </div>
      </dl>

      {/* A status, not a warning: new source data is picked up on schedule
        * and needs nothing from the reader. */}
      <p className="avail-status">
        {due.due
          ? `Comtrade has new data since ${dayLabel(due.pulled)}. The ${dayLabel(nextRefresh())} refresh adds it.`
          : `Nothing new since ${dayLabel(due.pulled)}. The figures are as current as the source.`}
      </p>

      <section className="avail-block">
        <h2 className="rf-h2">Annual</h2>

        {phone ? (
          <Rows
            label="Annual coverage by year"
            items={annual.map(row => ({
              id: row.period,
              title: row.period,
              subtitle: (
                <span className="avail-bar">
                  <span style={{ width: `${(row.reporters / peak) * 100}%` }} />
                </span>
              ),
              fields: [
                { label: 'Economies filed', value: row.reporters, lead: true, numeric: true },
                { label: 'Latest release', value: dayLabel(row.latestRelease), numeric: true },
              ],
            }))}
          />
        ) : (
          <table className="rf-table avail-table">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">Economies filed</th>
                <th scope="col">Coverage</th>
                <th scope="col" className="num">Latest release</th>
              </tr>
            </thead>

            <tbody>
              {annual.map(row => (
                <tr key={row.period}>
                  <td><strong>{row.period}</strong></td>
                  <td className="num">{row.reporters}</td>
                  <td>
                    <span className="avail-bar">
                      <span style={{ width: `${(row.reporters / peak) * 100}%` }} />
                    </span>
                  </td>
                  <td className="num">{dayLabel(row.latestRelease)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {monthly.length > 0 && (
        <section className="avail-block">
          <h2 className="rf-h2">Monthly</h2>

          <p className="avail-note">Fewer economies file monthly, so world totals use annual data.</p>

          {phone ? (
            <Rows
              label="Monthly coverage"
              items={monthly.map(row => ({
                id: row.period,
                title: monthLabel(row.period),
                fields: [
                  { label: 'Economies filed', value: row.reporters, lead: true, numeric: true },
                  { label: 'Latest release', value: dayLabel(row.latestRelease), numeric: true },
                ],
              }))}
            />
          ) : (
            <table className="rf-table avail-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">Economies filed</th>
                  <th scope="col" className="num">Latest release</th>
                </tr>
              </thead>

              <tbody>
                {monthly.map(row => (
                  <tr key={row.period}>
                    <td>{monthLabel(row.period)}</td>
                    <td className="num">{row.reporters}</td>
                    <td className="num">{dayLabel(row.latestRelease)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {data.holes.length > 0 && (
        <section className="avail-block">
          <h2 className="rf-h2">Not yet filed</h2>

          <p className="avail-note">Each gap is sized by what the economy filed the year before.</p>

          <div className="avail-holes">
            {data.holes.slice(0, 14).map(hole => (
              <article className="avail-hole" key={`${hole.period}-${hole.reporter}`}>
                <div className="avail-hole-head">
                  <strong>{hole.reporter}</strong>
                  <span className="avail-hole-year">{hole.period}</span>
                  {hole.filedSince && <span className="avail-filed">now filed</span>}
                </div>

                <p>
                  {hole.products} of {data.productsTotal} products, {usd(hole.priorValue)} the year before.
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="rf-source">
        Source: UN Comtrade data availability. Checked on the 1st of each month. Updated {dayLabel(data.builtAt)}.
      </footer>
    </div>
  )
}
