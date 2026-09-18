import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'

import {
  loadAvailability,
  monthLabel,
  refreshDue,
  type Availability as Data,
} from '../lib/availability'
import { usd } from '../lib/format'

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

  useEffect(() => {
    loadAvailability().then(result => setData(result))
  }, [])

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

        <h1>Not fetched yet</h1>

        <p>
          This page mirrors UN Comtrade's own record of who has filed what, and
          joins it to our 418 products. It is built by the pipeline rather than
          fetched by your browser, because Comtrade refuses cross-origin calls
          and because a dashboard that phones a third party on every page load
          inherits that third party's downtime.
        </p>

        <pre className="avail-cmd">python3 pipeline/comtrade/fetch_availability.py</pre>

        <p className="avail-note">
          No key needed — it uses Comtrade's public endpoint. Commit the file it
          writes and this page fills in.
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
      <header className="avail-head">
        <div>
          <div className="eyebrow">UN COMTRADE · DATA AVAILABILITY</div>

          <h1>Who has filed, and what it costs us</h1>

          <p className="avail-lede">
            Comtrade's own record of which economies have submitted data for
            which period, joined to the {data.productsTotal} products we track.
            Fetched {data.fetchedAt.slice(0, 10)}; our snapshot was built{' '}
            {data.snapshotRefreshedAt?.slice(0, 10) ?? 'unknown'}.
          </p>
        </div>

        <a
          className="avail-source"
          href={data.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Comtrade's own page <ExternalLink size={12} />
        </a>
      </header>

      <div className={due.due ? 'avail-verdict due' : 'avail-verdict fine'}>
        {due.due ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}

        <div>
          <strong>
            {due.due ? 'A refresh would bring in new data' : 'Nothing new since our last refresh'}
          </strong>

          <span>
            {due.due
              ? `Comtrade has released data as recently as ${due.since}, after our snapshot was built. Running the monthly refresh would pick it up.`
              : 'Comtrade has published nothing since our snapshot was built. The figures on this dashboard are as current as the source allows.'}
          </span>
        </div>
      </div>

      <section className="avail-block">
        <h2>Annual — what the world figures are built from</h2>

        <table className="dgcis-table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Economies filed</th>
              <th>Coverage</th>
              <th className="num">Latest release</th>
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
                <td className="num dgcis-month">{row.latestRelease ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {monthly.length > 0 && (
        <section className="avail-block">
          <h2>Monthly — further ahead, but thinner</h2>

          <p className="avail-note">
            Monthly data runs months ahead of annual, but far fewer economies
            file it — and the largest electronics traders are among those that
            do not. It is shown here because it exists, not because a world
            total could be built from it.
          </p>

          <table className="dgcis-table compact">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Economies filed</th>
                <th className="num">Latest release</th>
              </tr>
            </thead>

            <tbody>
              {monthly.map(row => (
                <tr key={row.period}>
                  <td>{monthLabel(row.period)}</td>
                  <td className="num">{row.reporters}</td>
                  <td className="num dgcis-month">{row.latestRelease ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.holes.length > 0 && (
        <section className="avail-block">
          <h2>The gaps, and which of our products they hit</h2>

          <p className="avail-note">
            A missing economy does not blank a page — it understates it. This is
            what each absence is worth, using what that economy filed the year
            before.
          </p>

          <div className="avail-holes">
            {data.holes.slice(0, 14).map(hole => (
              <article className="avail-hole" key={`${hole.period}-${hole.reporter}`}>
                <div className="avail-hole-head">
                  <strong>{hole.reporter}</strong>
                  <span className="avail-hole-year">{hole.period}</span>
                  {hole.filedSince && (
                    <span className="avail-filed">has since filed</span>
                  )}
                </div>

                <p>
                  Missing from <strong>{hole.products}</strong> of our products,
                  worth <strong>{usd(hole.priorValue, 1)}</strong> the year before.
                </p>

                {onOpen && (
                  <div className="avail-sample">
                    {hole.sample.slice(0, 6).map(code => (
                      <button key={code} className="linkish" onClick={() => onOpen(code, 6)}>
                        {code}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="dgcis-foot">
        Source: {data.source}. Built {data.builtAt.slice(0, 10)} by
        pipeline/comtrade/fetch_availability.py, which uses Comtrade's public
        endpoint and needs no subscription key. This page reports what the
        source holds; it does not estimate anything that is missing.
      </p>
    </div>
  )
}
