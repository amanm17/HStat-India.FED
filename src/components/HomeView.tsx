import { useMemo, useState } from 'react'

import type { CatalogueEntry, Manifest, SearchItem } from '../types'
import type { SearchIndex } from '../lib/search'
import { usd, ordinal, pct, nameOf } from '../lib/format'
import { SearchHub } from './SearchHub'
import { HomeTariffLines } from './HomeTariffLines'
import { FileText } from 'lucide-react'
import { usePageHelp } from '../lib/pagehelp'

/*
 * The landing page.
 *
 * Until now the dashboard opened straight onto one hard-coded product, which
 * gave a first-time visitor no idea what the thing covers or how to get
 * anywhere else. This is the front door: search first, because most people
 * arrive with a product in mind, and the shape of the sector underneath it
 * for everyone who does not.
 *
 * Everything here is derived from catalogue.json, which the app already
 * loads. No new data file, no extra request.
 */

type Props = {
  catalogue: CatalogueEntry[]
  manifest: Manifest
  index: SearchIndex
  recent: string[]
  inBasket: (code: string) => boolean
  onOpen: (code: string, level: 2 | 4 | 6) => void
  onAdd: (item: SearchItem) => void
  onOpenHs8?: (hs8: string) => void
  commands?: import('./SearchHub').Command[]
  onLines?: () => void
  /* The reader's own saved reports. Local to this browser; nothing is shared. */
  reports?: import('../lib/workspace').SavedReport[]
  onOpenReport?: (report: import('../lib/workspace').SavedReport) => void
}

export function HomeView({
  catalogue,
  manifest,
  index,
  recent,
  inBasket,
  onOpen,
  onAdd,
  onOpenHs8,
  commands,
  onLines,
  reports,
  onOpenReport,
}: Props) {
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const products = useMemo(
    () => catalogue.filter(entry => entry.level === 6),
    [catalogue],
  )

  const stats = useMemo(() => {
    const withTrade = products.filter(entry => entry.globalTrade !== null)

    return {
      products: products.length,
      tracked: withTrade.reduce((sum, entry) => sum + (entry.globalTrade ?? 0), 0),
    }
  }, [products])

  /* Products where India is among the largest importers in the world. The
   * rank is against every reporting economy, so a single digit is a lot. */
  /*
   * Sorted by share, not by rank.
   *
   * Sorting by rank put six rank-1 products on screen and printed "1st" six
   * times: a column of identical values, which is a column carrying nothing.
   * India places first in far more than six of these lines, so rank cannot be
   * what separates them - share can. 35.6% of the world's unassembled
   * photovoltaic cells is a different fact from 14.1% of its lamp carbons,
   * and it is the one a reader is actually looking for here.
   *
   * Rank is still shown, small, because "largest buyer" is what makes the
   * share worth reading. How many lines India leads is now said once, in the
   * panel head, instead of implied six times down the side.
   */
  const leads = useMemo(
    () =>
      products
        .filter(
          entry =>
            entry.indiaRank !== null &&
            entry.indiaRank <= 10 &&
            entry.indiaShare !== null &&
            entry.indiaShare !== undefined,
        )
        .sort((a, b) => (b.indiaShare ?? 0) - (a.indiaShare ?? 0))
        .slice(0, 6),
    [products],
  )

  const leadCount = useMemo(
    () => products.filter(entry => entry.indiaRank === 1).length,
    [products],
  )

  usePageHelp(
    () => ({
      facts: [
        {
          label: 'Products tracked',
          value: String(stats.products),
          note: `six-digit electronics lines, ${manifest.startYear} to ${manifest.endYear}`,
        },
        {
          label: 'World trade covered',
          value: usd(stats.tracked),
          note: 'each line in its own latest validated year, so an order of magnitude',
        },
        {
          label: 'Where India leads',
          value: `${leadCount} lines`,
          note: 'India is the largest importer in the world',
        },
        {
          label: 'Snapshot built',
          value: new Date(manifest.refreshedAt).toLocaleDateString(),
          note: 'the figures here are as current as the source allows',
        },
      ],

      presented: [
        { name: 'Search', what: 'by product word or HS code; “/” opens the command palette' },
        { name: 'Biggest share', what: 'the lines where India takes most of world imports' },
        { name: 'Largest markets', what: 'the biggest world markets tracked here' },
        { name: 'Tariff lines', what: 'India\u2019s own eight-digit detail, and what is moving' },
        { name: 'Categories', what: 'the catalogue, grouped' },
      ],
    }),
    [stats.products, stats.tracked, leadCount, manifest],
  )

  const largest = useMemo(
    () =>
      products
        .filter(entry => entry.globalTrade !== null)
        .sort((a, b) => (b.globalTrade ?? 0) - (a.globalTrade ?? 0))
        /* Two rows more than its neighbour, because its rows are two lines to
         * the neighbour's three and the column was ending 200px short. */
        .slice(0, 8),
    [products],
  )

  /*
   * Two questions, not one.
   *
   * "Finished goods" and "components" were mixed together in a single list of
   * categories, so a reader after phones and a reader after the parts that go
   * into phones were given the same undifferentiated grid. The split already
   * exists in the data - `segment` is Final Goods or Components on every code,
   * 208 against 210 - it simply was not used.
   *
   * A category legitimately spans both sides: Consumer Durables has 90 final
   * lines and 34 component lines. So a category appears under each side it
   * actually has members on, carrying only those members, rather than being
   * forced onto one side for the sake of a tidy diagram.
   */
  const bySegment = useMemo(() => {
    const build = (segment: string) => {
      const groups = new Map<string, CatalogueEntry[]>()

      for (const entry of products) {
        if ((entry.segment || '').toLowerCase() !== segment) continue

        const key = entry.category || 'Unclassified'

        groups.set(key, [...(groups.get(key) ?? []), entry])
      }

      return [...groups.entries()]
        .map(([name, rows]) => ({
          name,
          segment,
          key: `${segment}:${name}`,
          rows: rows.sort((a, b) => (b.globalTrade ?? 0) - (a.globalTrade ?? 0)),
          trade: rows.reduce((sum, row) => sum + (row.globalTrade ?? 0), 0),
        }))
        .sort((a, b) => b.trade - a.trade)
    }

    return {
      final: build('final goods'),
      components: build('components'),
    }
  }, [products])

  const categories = useMemo(
    () => [...bySegment.final, ...bySegment.components],
    [bySegment],
  )

  const shown = categories.find(item => item.key === openCategory)

  return (
    <div className="home">
      <section className="home-hero">
        <p className="home-eyebrow">Electronics trade, by HS code</p>

        <h1 className="home-title">
          HStat.<strong>India</strong>
        </h1>

        <p className="home-lede">
          World imports and India&rsquo;s position in them for{' '}
          {stats.products} electronics product lines, from{' '}
          {manifest.startYear} to {manifest.endYear}. Every figure comes from
          UN Comtrade as filed, and a year that cannot be trusted is left
          blank rather than estimated.
        </p>

        <div className="home-search">
          <SearchHub
          onOpenHs8={onOpenHs8}
          commands={commands}
            index={index}
            recent={recent}
            inBasket={inBasket}
            onOpen={item => {
              if (item.retired) return

              onOpen(item.code, item.level)
            }}
            onAdd={onAdd}
          />
        </div>

        <div className="home-stats">
          <div>
            <strong>{stats.products}</strong>
            <span>product lines</span>
          </div>

          {/*
            * The HS-4 and HS-2 counts that used to sit here were structure,
            * not information: nobody arrives wanting to know how many headings
            * the nomenclature has. Two numbers is what the front page needs -
            * how much is covered, and how much trade that is.
            */}

          <div>
            <strong>{usd(stats.tracked, 0)}</strong>
            <span>global imports tracked</span>
          </div>
        </div>

        <p className="home-footnote">
          Each product counted in its own latest validated year, so the total is
          an order of magnitude, not a single year.
        </p>
      </section>

      {/* India's own eight-digit detail had no presence on the front page at
        * all: a reader had to already know it existed, then find a product
        * that happened to have it. This is the door. */}
      <HomeTariffLines onOpenHs8={onOpenHs8} onLines={onLines} />

      {/*
        * Work you have already done, where you will look for it.
        *
        * Reports were reachable only from the right-hand rail of whichever
        * product page you happened to be on - so a report built on Monday was
        * effectively lost by Tuesday unless you remembered which code you
        * built it from. Only shown when there are any: an empty panel
        * explaining a feature nobody has used yet is an advertisement.
        */}
      {reports && reports.length > 0 && (
        <section className="home-reports">
          <div className="home-panel-head">
            <span className="eyebrow">YOUR SAVED REPORTS</span>

            <span className="home-panel-note">
              kept in this browser only — never uploaded
            </span>
          </div>

          <div className="home-reports-list">
            {reports.slice(0, 6).map(report => (
              <button
                key={report.id}
                onClick={() => onOpenReport?.(report)}
                title={`Rebuild ${report.name}`}
              >
                <FileText size={14} />

                <span className="home-report-main">
                  <strong>{report.name}</strong>
                  <small>{report.subject}</small>
                </span>

                <span className="home-report-when">
                  {new Date(report.lastRunAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="home-columns">
        <section className="home-panel">
          <div className="home-panel-head">
            <span className="eyebrow">WHERE INDIA TAKES THE BIGGEST SHARE</span>
            <span className="home-panel-note">
              {leadCount > 0
                ? `Share of world imports · India is the largest buyer in ${leadCount} of these lines`
                : 'Share of world imports · India\u2019s own imports, net of re-imports'}
            </span>
          </div>

          {leads.length === 0 && (
            <p className="home-empty">
              No product in this snapshot places India in the top ten importers
              for its latest validated year.
            </p>
          )}

          {/*
            * This tile used to show one money figure - the world total - under
            * a heading about India's rank, so $59.0bn beside "1st" read as
            * India buying $59bn of it. It was actually the whole world's.
            *
            * India's own number was never missing, only unexposed: it is the
            * exact numerator indiaShare is divided from, so nothing here is
            * share x world. It now leads, and the world total sits behind it
            * as the thing India holds a share OF.
            */}
          <ul className="home-list home-list-india">
            {leads.map(entry => (
              <li key={entry.code}>
                <button onClick={() => onOpen(entry.code, entry.level)}>
                  <span className="home-share">{pct(entry.indiaShare, 1)}</span>

                  <span className="home-list-main">
                    <strong>{nameOf(entry)}</strong>

                    {/*
                      * Rank leads this line rather than trailing the name. As a
                      * chip it needed a tooltip to mean anything and it fell off
                      * the end of the longer names; here it reads as a sentence,
                      * and it is the part that survives if the line truncates.
                      */}
                    <small>
                      <b>{ordinal(entry.indiaRank)} largest buyer</b> · HS{' '}
                      {entry.code} · {entry.globalTradeYear}
                      {entry.provisional?.length ? ' · provisional' : ''}
                    </small>
                  </span>

                  <span className="home-list-money">
                    <strong>
                      {entry.indiaTradeValue === null ||
                      entry.indiaTradeValue === undefined
                        ? '—'
                        : usd(entry.indiaTradeValue, 1)}
                    </strong>
                    <small>India imports</small>
                    <em>world {usd(entry.globalTrade, 1)}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-panel">
          <div className="home-panel-head">
            <span className="eyebrow">THE LARGEST WORLD MARKETS TRACKED</span>
            <span className="home-panel-note">
              Global imports, net of re-imports
            </span>
          </div>

          <ul className="home-list">
            {largest.map(entry => (
              <li key={entry.code}>
                <button onClick={() => onOpen(entry.code, entry.level)}>
                  <span className="home-list-main wide">
                    <strong>{nameOf(entry)}</strong>
                    <small>
                      HS {entry.code} · India {ordinal(entry.indiaRank)} ·{' '}
                      {entry.globalTradeYear}
                      {entry.provisional?.length ? ' · provisional' : ''}
                    </small>
                  </span>

                  <span className="home-list-value">
                    {usd(entry.globalTrade, 1)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="home-panel home-categories">
        <div className="home-panel-head">
          <span className="eyebrow">EXPLORE BY TYPE</span>
          <span className="home-panel-note">
            {stats.products} lines · finished goods and the components that go
            into them
          </span>
        </div>

        {([
          {
            key: 'final',
            title: 'Finished goods',
            blurb: 'Products sold as they are',
            groups: bySegment.final,
          },
          {
            key: 'components',
            title: 'Components & inputs',
            blurb: 'Parts, materials and sub-assemblies',
            groups: bySegment.components,
          },
        ] as const).map(side => (
          <div key={side.key} className="home-segment">
            <div className="home-segment-head">
              <h3>{side.title}</h3>
              <span>
                {side.blurb} ·{' '}
                {side.groups.reduce((sum, item) => sum + item.rows.length, 0)}{' '}
                lines
              </span>
            </div>

            <div className="home-cat-grid">
              {side.groups.map(item => (
                <button
                  key={item.key}
                  className={openCategory === item.key ? 'active' : ''}
                  aria-expanded={openCategory === item.key}
                  onClick={() =>
                    setOpenCategory(current =>
                      current === item.key ? null : item.key,
                    )
                  }
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.rows.length} lines · {usd(item.trade, 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {shown && (
          <div className="home-cat-open">
            <div className="home-cat-open-head">
              <strong>
                {shown.name}
                <span className="home-cat-open-side">
                  {shown.segment === 'final goods'
                    ? 'finished goods'
                    : 'components & inputs'}
                </span>
              </strong>
              <button
                className="linklike"
                onClick={() => setOpenCategory(null)}
              >
                Close
              </button>
            </div>

            <div className="home-cat-list">
              {shown.rows.map(entry => (
                <button
                  key={entry.code}
                  onClick={() => onOpen(entry.code, entry.level)}
                >
                  <span className="home-cat-code">{entry.code}</span>
                  <span className="home-cat-name">
                    {nameOf(entry)}
                  </span>
                  <span className="home-cat-value">
                    {entry.globalTrade === null ? '—' : usd(entry.globalTrade, 1)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
