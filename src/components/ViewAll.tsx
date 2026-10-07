/*
 * "View all": a ranking in full, on its own page.
 *
 * The third step of the + pattern (top 5 -> top 10 -> everything). It reads
 * the same rows the table on the page came from - the detail file for a
 * product, scope.json for the front page - so the first ten here are exactly
 * the ten there. Where the snapshot holds only the top of a list (years
 * before full lists begin) the page says so instead of padding it.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download } from 'lucide-react'

import type { CatalogueEntry, CurrencyBlock, CurrencyMode, HsNode } from '../types'
import { loadHsNode } from '../lib/data'
import {
  latestScopeYear,
  loadDetail,
  loadScope,
  rankingFor,
  type RankKind,
  type RankRow,
  type ScopeSummary,
} from '../lib/scope'
import { money } from '../lib/currency'
import { nameOf, pct, usd } from '../lib/format'
import { downloadCsv, downloadXlsx } from '../lib/export'
import { segmentKey } from './HomePage'

export type ViewAllTarget =
  | { scope: 'home'; kind: 'importers' | 'exporters' | 'finished' | 'components'; year: number | null }
  | { scope: 'product'; code: string; kind: RankKind; year: number | null }

export const VIEW_ALL_SLUGS: Record<RankKind, string> = {
  importers: 'importers',
  exporters: 'exporters',
  indiaSuppliers: 'import-partners',
  indiaDestinations: 'export-partners',
}

const TITLES: Record<string, string> = {
  importers: 'Top Importers',
  exporters: 'Top Exporters',
  indiaSuppliers: 'India Import Partners',
  indiaDestinations: 'India Export Partners',
  finished: 'Top Traded Products · Finished Goods',
  components: 'Top Traded Products · Components & Inputs',
}

export function ViewAll({
  target,
  snapshot,
  catalogue,
  currency,
  currencyBlock,
  onOpen,
  onBack,
}: {
  target: ViewAllTarget
  snapshot: string
  catalogue: CatalogueEntry[]
  currency: CurrencyMode
  currencyBlock?: CurrencyBlock
  onOpen: (code: string, level: 2 | 4 | 6) => void
  onBack: () => void
}) {
  const [node, setNode] = useState<HsNode | null>(null)
  const [scope, setScope] = useState<ScopeSummary | null>(null)
  const [rows, setRows] = useState<RankRow[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(target.year)
  const [filter, setFilter] = useState('')

  const byCode = useMemo(() => new Map(catalogue.map(entry => [entry.code, entry])), [catalogue])

  useEffect(() => {
    let live = true

    ;(async () => {
      if (target.scope === 'home') {
        const summary = await loadScope(snapshot)

        if (!live) return

        setScope(summary)

        const chosen = target.year ?? latestScopeYear(summary)

        setYear(chosen)

        const record = summary && chosen !== null ? summary.years[String(chosen)] : null

        if (!record) {
          setRows([])
          return
        }

        if (target.kind === 'importers' || target.kind === 'exporters') {
          const total = target.kind === 'importers' ? record.worldImports : record.worldExports

          setRows(
            record[target.kind].map(([code, value, estimated], position) => ({
              rank: position + 1,
              code,
              name: summary?.reporters?.[code] ?? code,
              value,
              share: total ? value / total : null,
              estimated: estimated > 0,
            })),
          )
        } else {
          setRows(
            record.products
              .filter(([code]) => segmentKey(byCode.get(code)?.segment) === target.kind)
              .map(([code, value, estimatedShare], position) => ({
                rank: position + 1,
                code,
                name: nameOf(byCode.get(code)),
                value,
                share: record.worldImports ? value / record.worldImports : null,
                estimated: estimatedShare > 0,
              })),
          )
        }

        setNote(null)
        return
      }

      const entry = byCode.get(target.code)
      const level = (entry?.level ?? (target.code.length === 2 ? 2 : target.code.length === 4 ? 4 : 6)) as 2 | 4 | 6

      const [loaded, detail] = await Promise.all([
        loadHsNode(snapshot, target.code, level),
        loadDetail(snapshot, target.code),
      ])

      if (!live) return

      const chosen = target.year ?? loaded.globalTrade?.year ?? Math.max(...loaded.years)

      setNode(loaded)
      setYear(chosen)

      const ranking = rankingFor(target.kind, loaded, chosen, detail)

      setRows(ranking.rows)
      setNote(
        ranking.complete
          ? null
          : ranking.source === 'detail'
            ? `Full country lists are published from ${detail?.fullListsFrom ?? 2016}; ${chosen} shows the top ${ranking.rows.length} of ${ranking.count}.`
            : `This snapshot holds the top ${ranking.rows.length} for ${chosen}. Full lists arrive with the next data refresh.`,
      )
    })().catch(() => {
      if (live) setRows([])
    })

    return () => {
      live = false
    }
  }, [target, snapshot, byCode])

  const india = target.scope === 'product' && (target.kind === 'indiaSuppliers' || target.kind === 'indiaDestinations')

  const format = (value: number) =>
    india && year !== null
      ? money(value, currency, currencyBlock, String(year), { basis: 'CY' }).text
      : usd(value)

  const shown = (rows ?? []).filter(row =>
    !filter.trim() || row.name.toLowerCase().includes(filter.trim().toLowerCase()) || row.code.includes(filter.trim()),
  )

  const product = target.scope === 'home' && (target.kind === 'finished' || target.kind === 'components')

  const subject =
    target.scope === 'product'
      ? `${node ? nameOf(node) : ''} · HS-${node?.level ?? ''} ${target.code}`
      : 'Electronics scope'

  const title = TITLES[target.kind]

  const shareLabel =
    target.scope === 'home'
      ? 'Share of scope'
      : target.kind === 'indiaSuppliers'
        ? "Share of India's imports"
        : target.kind === 'indiaDestinations'
          ? "Share of India's exports"
          : 'Share of product trade'

  const exportRows = () =>
    (rows ?? []).map(row => ({
      Rank: row.rank,
      [product ? 'HS-6' : 'Code']: row.code,
      [product ? 'Product' : 'Country']: row.name,
      'Value (USD)': row.value,
      [shareLabel]: row.share,
      Estimated: row.estimated ? 'Yes' : 'No',
    }))

  const meta = {
    title: `${title} — ${subject}`,
    period: year !== null ? `CY ${year}` : undefined,
    notes: ['Source: UN Comtrade via HStat.India. Values in US dollars.'],
  }

  const name = `HStat-${target.scope === 'product' ? target.code : 'scope'}-${title.replace(/[^A-Za-z]+/g, '-')}-${year ?? ''}`

  return (
    <div className="rf-viewall-page">
      <button type="button" className="rf-link rf-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden /> Back
      </button>

      <div className="rf-viewall-head">
        <div>
          <span className="rf-eyebrow">{subject}{year !== null ? ` · CY ${year}` : ''}</span>
          <h1>{title}</h1>
        </div>

        <div className="rf-viewall-actions">
          <input
            className="rf-filter"
            type="search"
            placeholder={product ? 'Filter products' : 'Filter countries'}
            value={filter}
            onChange={event => setFilter(event.target.value)}
            aria-label="Filter the list"
          />
          <button type="button" className="rf-button" onClick={() => downloadCsv(name, exportRows(), meta)}>
            <Download size={16} aria-hidden /> CSV
          </button>
          <button type="button" className="rf-button" onClick={() => downloadXlsx(name, { [title.slice(0, 28)]: exportRows() }, meta)}>
            <Download size={16} aria-hidden /> Excel
          </button>
        </div>
      </div>

      {note && <p className="rf-note">{note}</p>}

      {rows === null ? (
        <p className="rf-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rf-empty">No ranking for this year.</p>
      ) : (
        <div className="rf-tablewrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th scope="col" className="rf-rank">Rank</th>
                <th scope="col">{product ? 'Product' : 'Country'}</th>
                <th scope="col" className="num">{product ? 'World imports' : 'Value'}</th>
                <th scope="col" className="num">{shareLabel}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => (
                <tr key={row.code} className={row.code === '699' ? 'rf-emphasis' : undefined}>
                  <td className="rf-rank">{row.rank}</td>
                  <td className="rf-name">
                    {product ? (
                      <button type="button" className="rf-link" onClick={() => onOpen(row.code, 6)}>
                        {row.name} <span className="rf-code-inline">{row.code}</span>
                      </button>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td className="num">
                    {format(row.value)}
                    {row.estimated && <abbr className="estimated-mark" title="Contains estimated values">*</abbr>}
                  </td>
                  <td className="num">{pct(row.share, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scope === null && target.scope === 'home' && rows?.length === 0 && (
        <p className="rf-empty">Scope totals appear once the data refresh has run.</p>
      )}
    </div>
  )
}
