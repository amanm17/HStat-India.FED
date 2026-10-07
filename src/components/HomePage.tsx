/*
 * The front page (execution prompt §2.3).
 *
 * Priority information only: one search bar, the year and currency, three
 * figures for the whole FED scope, four rankings, and the segments. Every
 * figure is the sum of the 418 HS-6 lines for the selected year - computed
 * by the refresh into scope.json, from the same reporter tables the product
 * pages rank - so a total here is exactly the products listed under it.
 */
import { useEffect, useMemo, useState } from 'react'
import { FileText, Layers } from 'lucide-react'

import type { CatalogueEntry, CurrencyMode, Manifest, SearchItem } from '../types'
import type { SearchIndex } from '../lib/search'
import type { SavedReport } from '../lib/workspace'
import { SearchHub, type Command } from './SearchHub'
import { DownloadMenu } from './DownloadMenu'
import { HomeTariffLines } from './HomeTariffLines'
import { FigureTile, Markers, RankedTable, Segmented } from './ui'
import { latestScopeYear, loadScope, type RankRow, type ScopeSummary } from '../lib/scope'
import { money } from '../lib/currency'
import { nameOf, pct, usd } from '../lib/format'
import { palette } from '../lib/palette'
import { usePageHelp } from '../lib/pagehelp'

export type HomeRankKind = 'importers' | 'exporters' | 'finished' | 'components'

type Props = {
  catalogue: CatalogueEntry[]
  manifest: Manifest
  snapshot: string
  index: SearchIndex
  recent: string[]
  inBasket: (code: string) => boolean
  onOpen: (code: string, level: 2 | 4 | 6) => void
  onAdd: (item: SearchItem) => void
  onOpenHs8?: (hs8: string) => void
  commands?: Command[]
  onLines?: () => void
  reports?: SavedReport[]
  onOpenReport?: (report: SavedReport) => void
  onViewAll: (kind: HomeRankKind, year: number) => void
  onStack: (entries: { code: string; level: 2 | 4 | 6 | 8 }[]) => void
  currency: CurrencyMode
  onCurrency: (mode: CurrencyMode) => void
  dark: boolean
  year: number | null
  onYear: (year: number) => void
}

const SEGMENTS = [
  { id: 'final goods', key: 'finished', title: 'Finished goods' },
  { id: 'components', key: 'components', title: 'Components & inputs' },
] as const

export function segmentKey(segment: string | undefined): 'finished' | 'components' | null {
  const value = (segment ?? '').toLowerCase()

  if (value.startsWith('final')) return 'finished'
  if (value.startsWith('component')) return 'components'

  return null
}

export function segmentTitle(segment: string | undefined): string {
  const key = segmentKey(segment)

  return key === 'finished' ? 'Finished goods' : key === 'components' ? 'Components & inputs' : segment ?? ''
}

export function HomePage({
  catalogue,
  manifest,
  snapshot,
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
  onViewAll,
  onStack,
  currency,
  onCurrency,
  dark,
  year: chosenYear,
  onYear,
}: Props) {
  const [scope, setScope] = useState<ScopeSummary | null | undefined>(undefined)

  useEffect(() => {
    let live = true

    loadScope(snapshot).then(result => {
      if (live) setScope(result)
    })

    return () => {
      live = false
    }
  }, [snapshot])

  const years = useMemo(
    () =>
      scope
        ? Object.entries(scope.years)
            .filter(([, value]) => value.lines > 0)
            .map(([period]) => Number(period))
            .sort((a, b) => b - a)
        : [],
    [scope],
  )

  const latest = latestScopeYear(scope ?? null)
  const year = chosenYear !== null && years.includes(chosenYear) ? chosenYear : latest

  const record = scope && year !== null ? scope.years[String(year)] : null

  const byCode = useMemo(() => {
    const map = new Map<string, CatalogueEntry>()

    for (const entry of catalogue) if (entry.level === 6) map.set(entry.code, entry)

    return map
  }, [catalogue])

  const products = useMemo(() => catalogue.filter(entry => entry.level === 6), [catalogue])

  const colours = palette(dark)

  const india = (value: number | null | undefined) =>
    year === null
      ? usd(value)
      : money(value, currency, manifest.currency, String(year), { basis: 'CY' }).text

  const countryRows = (rows: [string, number, number][] | undefined, total: number) =>
    (rows ?? []).map(
      ([code, value, estimated], position): RankRow => ({
        rank: position + 1,
        code,
        name: scope?.reporters?.[code] ?? code,
        value,
        share: total ? value / total : null,
        estimated: estimated > 0,
      }),
    )

  const importers = record ? countryRows(record.importers, record.worldImports) : []
  const exporters = record ? countryRows(record.exporters, record.worldExports) : []

  const productRows = (segment: 'finished' | 'components'): RankRow[] =>
    (record?.products ?? [])
      .filter(([code]) => segmentKey(byCode.get(code)?.segment) === segment)
      .map(([code, value, estimatedShare], position) => ({
        rank: position + 1,
        code,
        name: byCode.get(code) ? nameOf(byCode.get(code)) : code,
        value,
        share: record?.worldImports ? value / record.worldImports : null,
        estimated: estimatedShare > 0,
      }))

  const finished = productRows('finished')
  const components = productRows('components')

  const indiaImporterRow = importers.find(row => row.code === '699') ?? null
  const indiaExporterRow = exporters.find(row => row.code === '699') ?? null

  /* Key segments: two buckets, then categories, then HS-6 lines. Counted
   * from the catalogue at run time, never typed in. */
  const segments = useMemo(
    () =>
      SEGMENTS.map(side => {
        const members = products.filter(entry => segmentKey(entry.segment) === side.key)
        const groups = new Map<string, CatalogueEntry[]>()

        for (const entry of members) {
          const key = entry.category || 'Unclassified'

          groups.set(key, [...(groups.get(key) ?? []), entry])
        }

        const values = new Map((record?.products ?? []).map(row => [row[0], row]))

        return {
          ...side,
          lines: members.length,
          categories: [...groups.entries()]
            .map(([name, rows]) => ({
              name,
              key: `${side.key}:${name}`,
              rows,
              world: rows.reduce((sum, row) => sum + (values.get(row.code)?.[1] ?? 0), 0),
            }))
            .sort((a, b) => b.rows.length - a.rows.length || b.world - a.world),
        }
      }),
    [products, record],
  )

  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const shownCategory = segments
    .flatMap(side => side.categories.map(category => ({ ...category, side })))
    .find(category => category.key === openCategory)

  usePageHelp(
    () => ({
      title: 'HStat.India · front page',
      lines: [
        'The FED electronics scope: 418 six-digit product lines, summed for the year you choose.',
        'Global Trade is world imports as filed, plus estimates for economies that have not yet filed; a figure carrying * contains estimated values.',
      ],
      facts: record && year !== null
        ? [
            { label: 'Global Trade', value: usd(record.worldImports), note: `CY ${year} · ${record.lines} lines` },
            { label: 'India Exports', value: india(record.indiaExports), note: `CY ${year}` },
            { label: 'India Imports', value: india(record.indiaImports), note: `CY ${year}` },
          ]
        : [],
      presented: [
        { name: 'Search', what: 'by product word or HS code; "/" opens commands' },
        { name: 'Top importers and exporters', what: 'countries, across the whole scope' },
        { name: 'Top traded products', what: 'HS-6 lines, finished goods and components separately' },
        { name: 'Key segments', what: 'each category as one combined figure and its lines' },
      ],
    }),
    [record, year, currency],
  )

  const categoryValues = new Map((record?.products ?? []).map(row => [row[0], row]))

  return (
    <div className="rf-home">
      <section className="rf-home-search" aria-label="Search">
        <h1 className="sr-only">HStat.India</h1>
        <SearchHub
          variant="hub"
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
      </section>

      <div className="rf-controls">
        <label className="rf-control">
          <span>Year</span>
          <select
            id="home-year"
            value={year ?? ''}
            disabled={!years.length}
            onChange={event => onYear(Number(event.target.value))}
          >
            {years.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <div className="rf-control">
          <span>Currency</span>
          <Segmented<CurrencyMode>
            label="Currency"
            value={currency}
            onChange={onCurrency}
            options={[
              { id: 'USD', label: 'USD', title: 'US dollars' },
              { id: 'INR', label: 'INR', title: "Rupees, for India's own figures" },
            ]}
          />
        </div>

        {scope && record && year !== null && (
          <DownloadMenu
            filename={`HStat-scope-${year}`}
            makeTables={() =>
              import('../lib/workbook').then(module =>
                module.buildHomeDownload(scope, catalogue, year, { manifest, currency }),
              )
            }
            makeReport={() =>
              import('../lib/reportdata').then(module => module.homeDocument(scope, catalogue, year, manifest))
            }
          />
        )}
      </div>

      {scope === undefined ? (
        <div className="rf-tiles rf-loading" aria-busy="true" />
      ) : !record || year === null ? (
        <p className="rf-empty rf-wait">
          Scope totals are produced by the data refresh and appear once it has run.
        </p>
      ) : (
        <>
          <section className="rf-tiles" aria-label={`Electronics scope, ${year}`}>
            <FigureTile
              series="global"
              label="Global Trade"
              value={usd(record.worldImports)}
              estimatedShare={record.worldImports ? record.estimatedImports / record.worldImports : null}
              caption={currency === 'INR' ? 'World imports · US dollars' : 'World imports'}
            />
            <FigureTile
              series="exports"
              label="India Exports"
              value={india(record.indiaExports)}
              caption={
                indiaExporterRow
                  ? `${pct(indiaExporterRow.share, 1)} of world exports`
                  : 'India, to the world'
              }
            />
            <FigureTile
              series="imports"
              label="India Imports"
              value={india(record.indiaImports)}
              caption={
                indiaImporterRow
                  ? `${pct(indiaImporterRow.share, 1)} of world imports`
                  : 'India, from the world'
              }
            />
          </section>

          <p className="rf-scope-note">
            Electronics scope · {record.lines} HS-6 lines · CY {year}
          </p>

          <Markers estimated={record.estimatedImports > 0} />

          <div className="rf-grid">
            <RankedTable
              id="home-importers"
              title="Top Importers"
              rows={importers}
              count={importers.length}
              complete
              valueLabel="Imports"
              shareLabel="Share of scope"
              formatValue={value => usd(value)}
              colour={colours.global}
              highlight="699"
              pinnedRow={indiaImporterRow}
              onViewAll={() => onViewAll('importers', year)}
              dark={dark}
            />
            <RankedTable
              id="home-exporters"
              title="Top Exporters"
              rows={exporters}
              count={exporters.length}
              complete
              valueLabel="Exports"
              shareLabel="Share of scope"
              formatValue={value => usd(value)}
              colour={colours.global}
              highlight="699"
              pinnedRow={indiaExporterRow}
              onViewAll={() => onViewAll('exporters', year)}
              dark={dark}
            />
            <RankedTable
              id="home-finished"
              title="Top Traded Products · Finished Goods"
              rows={finished}
              count={finished.length}
              complete
              nameLabel="Product"
              valueLabel="World imports"
              shareLabel="Share of scope"
              formatValue={value => usd(value)}
              colour={colours.finished}
              extraColumns={[{ key: 'segment', label: 'Segment', render: () => 'Finished goods' }]}
              onRowOpen={row => onOpen(row.code, 6)}
              onViewAll={() => onViewAll('finished', year)}
              dark={dark}
            />
            <RankedTable
              id="home-components"
              title="Top Traded Products · Components & Inputs"
              rows={components}
              count={components.length}
              complete
              nameLabel="Product"
              valueLabel="World imports"
              shareLabel="Share of scope"
              formatValue={value => usd(value)}
              colour={colours.components}
              extraColumns={[{ key: 'segment', label: 'Segment', render: () => 'Components & inputs' }]}
              onRowOpen={row => onOpen(row.code, 6)}
              onViewAll={() => onViewAll('components', year)}
              dark={dark}
            />
          </div>
        </>
      )}

      <section className="rf-panel rf-segments" aria-labelledby="key-segments">
        <h2 id="key-segments" className="rf-h2">Key Segments</h2>

        {segments.map(side => (
          <div key={side.key} className="rf-segment" data-segment={side.key}>
            <h3 className="rf-segment-title">
              <i className="rf-seg-swatch" aria-hidden="true" />
              {side.title} <span>({side.lines})</span>
            </h3>

            <div className="rf-cat-grid">
              {side.categories.map(category => (
                <button
                  key={category.key}
                  type="button"
                  className={openCategory === category.key ? 'rf-cat active' : 'rf-cat'}
                  aria-expanded={openCategory === category.key}
                  onClick={() =>
                    setOpenCategory(current => (current === category.key ? null : category.key))
                  }
                >
                  <strong>{category.name}</strong>
                  <span>
                    {category.rows.length} lines
                    {record ? ` · ${usd(category.world, 1)}` : ''}
                  </span>
                </button>
              ))}
            </div>

            {shownCategory && shownCategory.side.key === side.key && (
              <CategoryStack
                title={shownCategory.name}
                segment={side.title}
                rows={shownCategory.rows}
                values={categoryValues}
                year={year}
                india={india}
                onOpen={code => onOpen(code, 6)}
                onClose={() => setOpenCategory(null)}
                onStack={() =>
                  onStack(shownCategory.rows.map(row => ({ code: row.code, level: 6 as const })))
                }
              />
            )}
          </div>
        ))}
      </section>

      <HomeTariffLines onOpenHs8={onOpenHs8} onLines={onLines} />

      {reports && reports.length > 0 && (
        <section className="rf-panel home-reports">
          <h2 className="rf-h2">Saved Reports</h2>

          <div className="home-reports-list">
            {reports.slice(0, 6).map(report => (
              <button key={report.id} onClick={() => onOpenReport?.(report)} title={`Open ${report.name}`}>
                <FileText size={16} />
                <span className="home-report-main">
                  <strong>{report.name}</strong>
                  <small>{report.subject}</small>
                </span>
                <span className="home-report-when">{new Date(report.lastRunAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/*
 * A category as one combined figure and its lines: the curated stack.
 *
 * HS-6 lines inside one category never contain each other, so the combined
 * figure is a plain sum and each line's share is of that sum. The reader can
 * take the lines into their own HStack from here.
 */
function CategoryStack({
  title,
  segment,
  rows,
  values,
  year,
  india,
  onOpen,
  onClose,
  onStack,
}: {
  title: string
  segment: string
  rows: CatalogueEntry[]
  values: Map<string, [string, number, number, number | null, number | null]>
  year: number | null
  india: (value: number | null | undefined) => string
  onOpen: (code: string) => void
  onClose: () => void
  onStack: () => void
}) {
  const lines = rows
    .map(row => {
      const value = values.get(row.code)

      return {
        code: row.code,
        name: nameOf(row),
        world: value?.[1] ?? null,
        estimated: (value?.[2] ?? 0) > 0,
        imports: value?.[3] ?? null,
        exports: value?.[4] ?? null,
      }
    })
    .sort((a, b) => (b.world ?? -1) - (a.world ?? -1))

  const world = lines.reduce((sum, line) => sum + (line.world ?? 0), 0)
  const exports = lines.reduce((sum, line) => sum + (line.exports ?? 0), 0)
  const imports = lines.reduce((sum, line) => sum + (line.imports ?? 0), 0)

  return (
    <div className="rf-stack" role="region" aria-label={`${title}, ${segment}`}>
      <div className="rf-stack-head">
        <div>
          <span className="rf-eyebrow">{segment}{year ? ` · CY ${year}` : ''}</span>
          <h3>{title}</h3>
        </div>

        <div className="rf-stack-actions">
          <button type="button" className="rf-button" onClick={onStack}>
            <Layers size={16} aria-hidden /> Open in HStack
          </button>
          <button type="button" className="rf-button quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="rf-stack-totals">
        <span>
          <b>Global Trade</b> {usd(world)}
        </span>
        <span>
          <b>India Exports</b> {india(exports)}
        </span>
        <span>
          <b>India Imports</b> {india(imports)}
        </span>
        <span>
          <b>Lines</b> {lines.length}
        </span>
      </div>

      <div className="rf-tablewrap">
        <table className="rf-table">
          <thead>
            <tr>
              <th scope="col">HS-6</th>
              <th scope="col">Product</th>
              <th scope="col" className="num">Global Trade</th>
              <th scope="col" className="num">Share of category</th>
              <th scope="col" className="num">India Exports</th>
              <th scope="col" className="num">India Imports</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line.code}>
                <td className="rf-code">{line.code}</td>
                <td className="rf-name">
                  <button type="button" className="rf-link" onClick={() => onOpen(line.code)}>
                    {line.name}
                  </button>
                </td>
                <td className="num">
                  {usd(line.world)}
                  {line.estimated && <abbr className="estimated-mark" title="Contains estimated values">*</abbr>}
                </td>
                <td className="num">{line.world && world ? pct(line.world / world, 1) : '—'}</td>
                <td className="num">{india(line.exports)}</td>
                <td className="num">{india(line.imports)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
