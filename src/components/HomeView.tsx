import { useMemo, useState } from 'react'

import type { CatalogueEntry, Manifest, SearchItem } from '../types'
import type { SearchIndex } from '../lib/search'
import { usd, ordinal, pct } from '../lib/format'
import { SearchHub } from './SearchHub'

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
}

export function HomeView({
  catalogue,
  manifest,
  index,
  recent,
  inBasket,
  onOpen,
  onAdd,
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
      headings: catalogue.filter(entry => entry.level === 4).length,
      chapters: catalogue.filter(entry => entry.level === 2).length,
      tracked: withTrade.reduce((sum, entry) => sum + (entry.globalTrade ?? 0), 0),
      priced: withTrade.length,
    }
  }, [products, catalogue])

  /* Products where India is among the largest importers in the world. The
   * rank is against every reporting economy, so a single digit is a lot. */
  const leads = useMemo(
    () =>
      products
        .filter(entry => entry.indiaRank !== null && entry.indiaRank <= 10)
        .sort(
          (a, b) =>
            (a.indiaRank ?? 99) - (b.indiaRank ?? 99) ||
            (b.globalTrade ?? 0) - (a.globalTrade ?? 0),
        )
        .slice(0, 6),
    [products],
  )

  const largest = useMemo(
    () =>
      products
        .filter(entry => entry.globalTrade !== null)
        .sort((a, b) => (b.globalTrade ?? 0) - (a.globalTrade ?? 0))
        .slice(0, 6),
    [products],
  )

  const categories = useMemo(() => {
    const groups = new Map<string, CatalogueEntry[]>()

    for (const entry of products) {
      const key = entry.category || 'Unclassified'

      groups.set(key, [...(groups.get(key) ?? []), entry])
    }

    return [...groups.entries()]
      .map(([name, rows]) => ({
        name,
        rows: rows.sort((a, b) => (b.globalTrade ?? 0) - (a.globalTrade ?? 0)),
        trade: rows.reduce((sum, row) => sum + (row.globalTrade ?? 0), 0),
      }))
      .sort((a, b) => b.trade - a.trade)
  }, [products])

  const shown = categories.find(item => item.name === openCategory)

  return (
    <div className="home">
      <section className="home-hero">
        <p className="home-eyebrow">Electronics trade, by HS code</p>

        <h1 className="home-title">
          HStat.<strong>India</strong>
        </h1>

        <p className="home-lede">
          World trade and India&rsquo;s position in it for{' '}
          {stats.products} electronics product lines, from{' '}
          {manifest.startYear} to {manifest.endYear}. Every figure comes from
          UN Comtrade as filed, and a year that cannot be trusted is left
          blank rather than estimated.
        </p>

        <div className="home-search">
          <SearchHub
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

          <div>
            <strong>{stats.headings}</strong>
            <span>HS-4 headings</span>
          </div>

          <div>
            <strong>{stats.chapters}</strong>
            <span>HS-2 chapters</span>
          </div>

          <div>
            <strong>{usd(stats.tracked, 0)}</strong>
            <span>world trade tracked</span>
          </div>
        </div>

        <p className="home-footnote">
          Each product is counted in its own most recent validated year, so the
          total is an order of magnitude rather than a single-year figure.
        </p>
      </section>

      <div className="home-columns">
        <section className="home-panel">
          <div className="home-panel-head">
            <span className="eyebrow">WHERE INDIA IS A TOP-TEN BUYER</span>
          </div>

          {leads.length === 0 && (
            <p className="home-empty">
              No product in this snapshot places India in the top ten
              importers for its latest validated year.
            </p>
          )}

          <ul className="home-list">
            {leads.map(entry => (
              <li key={entry.code}>
                <button onClick={() => onOpen(entry.code, entry.level)}>
                  <span className="home-rank">{ordinal(entry.indiaRank)}</span>

                  <span className="home-list-main">
                    <strong>{entry.product || entry.description}</strong>
                    <small>
                      HS {entry.code} · {pct(entry.indiaShare, 1)} of world
                      trade · {entry.globalTradeYear}
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

        <section className="home-panel">
          <div className="home-panel-head">
            <span className="eyebrow">THE LARGEST MARKETS TRACKED</span>
          </div>

          <ul className="home-list">
            {largest.map(entry => (
              <li key={entry.code}>
                <button onClick={() => onOpen(entry.code, entry.level)}>
                  <span className="home-list-main wide">
                    <strong>{entry.product || entry.description}</strong>
                    <small>
                      HS {entry.code} · India {ordinal(entry.indiaRank)} ·{' '}
                      {entry.globalTradeYear}
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
          <span className="eyebrow">BROWSE BY CATEGORY</span>
          <span className="home-panel-note">
            {categories.length} categories across {stats.products} lines
          </span>
        </div>

        <div className="home-cat-grid">
          {categories.map(item => (
            <button
              key={item.name}
              className={openCategory === item.name ? 'active' : ''}
              aria-expanded={openCategory === item.name}
              onClick={() =>
                setOpenCategory(current =>
                  current === item.name ? null : item.name,
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

        {shown && (
          <div className="home-cat-open">
            <div className="home-cat-open-head">
              <strong>{shown.name}</strong>
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
                    {entry.product || entry.description}
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
