/*
 * A product page: HS-2, HS-4 or HS-6 (execution prompt §2.4).
 *
 *   identity       the code, its name, its tagging
 *   furniture      year, currency, source, download, stacking, pin
 *   headline       Global Trade (gross), India Exports, India Imports - one row
 *   drawer         how the Global Trade figure is made (§2.6)
 *   sections       trend, world rankings, India's partners, tariff lines,
 *                  what is inside, classification history, key changes
 *
 * Every section is collapsible and reachable from the sticky tabs; on a phone
 * they start folded so nothing is a long scroll away. The reader can hide or
 * reorder sections from the workspace rail; identity and headline are not
 * optional, because they are how the rest of the page is addressed.
 *
 * Gross is the headline everywhere (decision log). Net of re-imports lives in
 * the drawer, and is raised onto the page only where the two differ by more
 * than 10% - the products where gross genuinely misleads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Pin, PinOff, Plus } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type {
  CatalogueEntry,
  CurrencyBlock,
  CurrencyMode,
  HsNode,
  Manifest,
  Methodology,
} from '../types'
import { loadHsNodes } from '../lib/data'
import { TILES, type Workspace } from '../lib/workspace'
import { delta, monthLabel, nameOf, ordinal, pct, plural, usd } from '../lib/format'
import { money, rateNote } from '../lib/currency'
import { palette } from '../lib/palette'
import { usePageHelp } from '../lib/pagehelp'
import { usePhone as useNarrow } from '../lib/viewport'
import {
  flowsOf,
  flowWord,
  formatPeriod,
  formatValue,
  last12,
  latestOf,
  loadDgcis,
  rollingChange,
  seriesFor,
  shareOfParent,
  totalSeries,
  unitLabel,
  type DgcisFlow,
  type DgcisNode,
} from '../lib/dgcis'
import {
  headlineFor,
  loadDetail,
  rankingFor,
  type Detail,
  type RankKind,
} from '../lib/scope'
import { Safely } from './Safely'
import { DownloadMenu } from './DownloadMenu'
import { Disclosure, Estimated, Tabs, type ChartView } from './primitives'
import {
  axisScale,
  buildCoverage,
  LineageNote,
  mirrorReading,
  PullData,
} from './ProductView'
import {
  FigureTile,
  jumpTo,
  Markers,
  RankedTable,
  Section,
  SectionTabs,
  Segmented,
} from './ui'
import { segmentKey, segmentTitle } from './HomePage'

export type DownloadRequest = {
  node: HsNode
  year: number
  detail: Detail | null
  dgcis: DgcisNode | null
  children: HsNode[]
}

type Props = {
  node: HsNode
  year: number
  onYearChange: (year: number) => void
  methodology: Methodology | null
  manifest: Manifest
  dark: boolean
  currency: CurrencyMode
  onCurrency: (mode: CurrencyMode) => void
  currencyBlock?: CurrencyBlock
  snapshot: string
  catalogue: CatalogueEntry[]
  workspace: Workspace
  hiddenTiles: string[]
  inBasket: boolean
  pinned: boolean
  onTogglePin: () => void
  onAddToStack: () => void
  onQuickStack?: (entries: { code: string; level: 2 | 4 | 6 | 8 }[]) => void
  onOpen: (code: string, level: 2 | 4 | 6) => void
  onOpenHs8?: (hs8: string) => void
  onHome: () => void
  onViewAll: (kind: RankKind, year: number) => void
}

const SECTION_LABELS: Record<string, string> = {
  trend: 'Trend',
  world: 'Importers & Exporters',
  partners: "India's Partners",
  dgcis: 'Tariff Lines',
  inside: 'Inside',
  lineage: 'Classification',
  signals: 'Key Changes',
}

export function ProductPage(props: Props) {
  const {
    node,
    year,
    onYearChange,
    methodology,
    manifest,
    dark,
    currency,
    onCurrency,
    currencyBlock,
    snapshot,
    catalogue,
    workspace,
    hiddenTiles,
    inBasket,
    pinned,
    onTogglePin,
    onAddToStack,
    onQuickStack,
    onOpen,
    onOpenHs8,
    onHome,
    onViewAll,
  } = props

  const narrow = useNarrow()
  const colours = palette(dark)

  /* ------------------------------------------------------------ data */

  const [detail, setDetail] = useState<Detail | null>(null)

  useEffect(() => {
    let live = true

    setDetail(null)
    loadDetail(snapshot, node.code).then(result => {
      if (live) setDetail(result)
    })

    return () => {
      live = false
    }
  }, [snapshot, node.code])

  const [dgcis, setDgcis] = useState<DgcisNode | null | undefined>(undefined)

  useEffect(() => {
    let live = true

    setDgcis(undefined)

    if (node.level !== 6) {
      setDgcis(null)
      return
    }

    loadDgcis(node.code)
      .then(result => {
        if (live) setDgcis(result)
      })
      .catch(() => {
        if (live) setDgcis(null)
      })

    return () => {
      live = false
    }
  }, [node.code, node.level])

  /* Defensive: a null inside `lines` must not take the page down. */
  const dgcisLineCodes = useMemo(
    () =>
      (dgcis?.lines ?? [])
        .map(line => line?.hs8)
        .filter((code): code is string => typeof code === 'string'),
    [dgcis],
  )

  const childCodes = useMemo<{ code: string; level: 2 | 4 | 6 }[]>(() => {
    if (node.level === 4) return (node.members ?? []).map(code => ({ code, level: 6 as const }))

    if (node.level === 2) {
      return catalogue
        .filter(entry => entry.level === 4 && entry.code.startsWith(node.code))
        .map(entry => ({ code: entry.code, level: 4 as const }))
    }

    return []
  }, [node, catalogue])

  const [children, setChildren] = useState<HsNode[]>([])

  useEffect(() => {
    if (!childCodes.length || childCodes.length > 60) {
      setChildren([])
      return
    }

    let cancelled = false

    loadHsNodes(snapshot, childCodes)
      .then(loaded => {
        if (!cancelled) setChildren(loaded)
      })
      .catch(() => {
        if (!cancelled) setChildren([])
      })

    return () => {
      cancelled = true
    }
  }, [childCodes, snapshot])

  const record = node.annual[String(year)]
  const headline = useMemo(() => headlineFor(node, year), [node, year])

  const india = useCallback(
    (value: number | null | undefined) =>
      money(value, currency, currencyBlock, String(year), { basis: 'CY' }).text,
    [currency, currencyBlock, year],
  )

  const inrNote = rateNote(currency, currencyBlock, String(year), 'CY')

  const retired = node.lineage?.retired ?? null
  const afterRetirement = retired?.validTo != null && year > retired.validTo
  const notYetCreated = record?.global.coverage?.status === 'HISTORICAL' &&
    Boolean((record.global.coverage as { notYetCreated?: string }).notYetCreated)

  /* ----------------------------------------------------- breadcrumb */

  const crumbs = useMemo(() => {
    const chain: { code: string; level: 2 | 4 | 6; name: string }[] = []
    const find = (code: string) => catalogue.find(entry => entry.code === code)

    if (node.level >= 4) {
      const chapter = node.code.slice(0, 2)
      chain.push({ code: chapter, level: 2, name: nameOf(find(chapter)) })
    }

    if (node.level === 6) {
      const heading = node.code.slice(0, 4)
      chain.push({ code: heading, level: 4, name: nameOf(find(heading)) })
    }

    return chain
  }, [node, catalogue])

  const parentLevel = node.level === 6
    ? { code: node.code.slice(0, 4), level: 4 as const }
    : node.level === 4
      ? { code: node.code.slice(0, 2), level: 2 as const }
      : null

  /* -------------------------------------------------------- sections */

  const off = (id: string) => hiddenTiles.includes(id)

  const available = useMemo(() => {
    const has: Record<string, boolean> = {
      trend: true,
      world: true,
      partners: Boolean(record?.india.suppliers?.rows.length || record?.india.destinations?.rows.length || detail?.years?.[String(year)]?.indiaSuppliers),
      dgcis: node.level === 6 && Boolean(dgcis),
      inside: node.level < 6 && childCodes.length > 0,
      lineage: Boolean(node.lineage?.predecessors?.length || node.lineage?.retired),
      signals: Boolean(record),
    }

    return workspace.order.filter(id => has[id] && !off(id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.order, hiddenTiles, record, detail, year, node, dgcis, childCodes])

  const [opened, setOpened] = useState<Record<string, number>>({})

  const jump = (id: string) => {
    setOpened(current => ({ ...current, [id]: (current[id] ?? 0) + 1 }))
    window.setTimeout(() => jumpTo(id), 30)
  }

  /* ------------------------------------------------------------ help */

  usePageHelp(
    () => ({
      title: `HS ${node.code} — ${nameOf(node)}`,
      lines: [
        'Global Trade is every reporting economy’s imports of this product from the world, as filed, plus estimates for economies that have not filed the year.',
        'India Exports and India Imports are India’s own filings. India’s tariff lines, below, are DGCIS data: a different source, never added to these figures.',
      ],
      code: {
        value: `HS-${node.level} ${node.code}`,
        what: node.description || node.product,
        note: retired
          ? `Retired in HS ${retired.revision}; the series ends at ${retired.validTo}.`
          : node.classification,
      },
      facts: [
        { label: 'Global Trade', value: usd(headline.global), note: `CY ${year}` },
        { label: 'India Exports', value: india(headline.indiaExports), note: `CY ${year}` },
        { label: 'India Imports', value: india(headline.indiaImports), note: `CY ${year}` },
      ],
      presented: available.map(id => ({
        name: SECTION_LABELS[id] ?? id,
        what: TILES.find(tile => tile.id === id)?.note ?? '',
      })),
      watch:
        'a figure marked * contains estimated values; open the calculation drawer to see how much.',
    }),
    [node, year, headline, available, currency],
  )

  /* --------------------------------------------------------- render */

  if (!record) {
    return <p className="rf-empty">No data for {year}.</p>
  }

  const segment = segmentKey(node.segment)

  const sectionProps = (id: string) => ({
    id,
    collapsedByDefault: narrow && id !== available[0],
    forceOpen: opened[id],
  })

  return (
    <div className="rf-product" data-level={node.level}>
      <nav className="rf-crumbs" aria-label="Breadcrumb">
        <button type="button" className="rf-link" onClick={onHome}>
          Home
        </button>
        {crumbs.map(crumb => (
          <span key={crumb.code}>
            <span aria-hidden="true">›</span>
            <button
              type="button"
              className="rf-link"
              onClick={() => onOpen(crumb.code, crumb.level)}
              title={crumb.name}
            >
              HS-{crumb.level} {crumb.code}
            </button>
          </span>
        ))}
        <span>
          <span aria-hidden="true">›</span>
          <span aria-current="page">HS-{node.level} {node.code}</span>
        </span>
      </nav>

      <section className="rf-identity" data-tile="identity" id="tile-identity">
        <div className="rf-idline">
          <span className="code-chip rf-code-chip">
            HS-{node.level} {node.code}
          </span>
          {segment && (
            <span className="rf-seg-tag" data-segment={segment}>
              {segmentTitle(node.segment)}
            </span>
          )}
          {node.category && <span className="rf-cat-tag">{node.category}</span>}
          {!node.inFedDefinition && <span className="rf-cat-tag">Reference only</span>}
          {retired && <span className="rf-cat-tag">Retired in HS {retired.revision}</span>}
        </div>

        <h1>{nameOf(node)}</h1>

        {nameOf(node) !== node.description && (
          <p className="rf-official">{node.description}</p>
        )}
      </section>

      <div className="rf-furniture" role="toolbar" aria-label="Page controls">
        <label className="rf-control">
          <span>Year</span>
          <select
            id="year-select"
            value={year}
            onChange={event => onYearChange(Number(event.target.value))}
          >
            {[...node.years].reverse().map(item => (
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

        <div className="rf-furniture-actions">
          <PullData node={node} year={year} onOpen={onOpen} />

          <DownloadMenu
            filename={`HStat-${node.code}`}
            makeTables={() =>
              import('../lib/workbook').then(module =>
                module.buildProductDownload(
                  { node, year, detail, dgcis: dgcis ?? null, children },
                  { manifest, currency },
                ),
              )
            }
            makeReport={() =>
              import('../lib/reportdata').then(module =>
                module.productDocument(
                  [{ node, detail, dgcis: dgcis ?? null, children }],
                  [year],
                  ['headline', ...available],
                  manifest,
                ),
              )
            }
          />

          <button type="button" className="rf-button stack-add" onClick={onAddToStack} disabled={inBasket}>
            <Plus size={16} aria-hidden /> {inBasket ? 'In HStack' : 'Add to HStack'}
          </button>

          {onQuickStack && parentLevel && (
            <button
              type="button"
              className="rf-button quiet stack-add"
              onClick={() =>
                onQuickStack([
                  { code: node.code, level: node.level },
                  { code: parentLevel.code, level: parentLevel.level },
                ])
              }
              title={`Stack this code with HS-${parentLevel.level} ${parentLevel.code}, to see its share of it`}
            >
              <Layers size={16} aria-hidden /> With HS-{parentLevel.level} parent
            </button>
          )}

          {onQuickStack && node.level === 6 && dgcisLineCodes.length > 1 && (
            <button
              type="button"
              className="rf-button quiet stack-add"
              onClick={() => onQuickStack(dgcisLineCodes.map(code => ({ code, level: 8 as const })))}
              title={`Stack all ${dgcisLineCodes.length} of India's tariff lines under this heading`}
            >
              <Layers size={16} aria-hidden /> All {dgcisLineCodes.length} tariff lines
            </button>
          )}

          <button
            type="button"
            className={pinned ? 'rf-button quiet pinned' : 'rf-button quiet'}
            onClick={onTogglePin}
            title={pinned ? 'Remove from the rail' : 'Pin to the rail'}
          >
            {pinned ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
            {pinned ? 'Pinned' : 'Pin'}
          </button>
        </div>
      </div>

      {inrNote && <p className="rf-rate-note">{inrNote}</p>}

      <section className="rf-headline" data-tile="headline" id="tile-headline" aria-label={`Headline figures, ${year}`}>
        <div className="rf-tiles">
          <FigureTile
            series="global"
            label={`Global Trade · ${year}`}
            value={headline.published ? usd(headline.global) : '—'}
            estimatedShare={headline.globalEstimatedShare}
            estimatedReporters={headline.globalEstimatedReporters}
            caption={
              headline.published
                ? currency === 'INR'
                  ? 'World imports · US dollars'
                  : 'World imports'
                : afterRetirement
                  ? `Code retired; last valid ${retired?.validTo}`
                  : notYetCreated
                    ? 'Code not yet in the classification'
                    : 'Not published for this year'
            }
          />
          <FigureTile
            series="exports"
            label="India Exports"
            value={india(headline.indiaExports)}
            caption={standingCaption(headline.indiaExportRank, headline.indiaExportShare, 'exporters', 'exports')}
          />
          <FigureTile
            series="imports"
            label="India Imports"
            value={india(headline.indiaImports)}
            caption={standingCaption(headline.indiaImportRank, headline.indiaImportShare, 'importers', 'imports')}
          />
        </div>

        {headline.published && headline.grossNetGap !== null && headline.grossNetGap > 0.1 && (
          <p className="rf-gap-alert" role="note">
            <strong>Re-imports are large for this product.</strong> Net of re-imports, Global Trade
            for {year} is {usd(headline.net)}, {pct(headline.grossNetGap, 0)} below the gross figure.
          </p>
        )}

        {record.global.provisional && record.global.provisional.length > 0 && (
          <p className="rf-provisional">
            <strong>{year} is still filling in.</strong> {record.global.provisional[0]}
          </p>
        )}

        <Markers estimated={(headline.globalEstimatedShare ?? 0) > 0} />

        <CalculationDrawer node={node} year={year} methodology={methodology} manifest={manifest} />
      </section>

      <SectionTabs
        sections={available.map(id => ({ id, label: SECTION_LABELS[id] ?? id }))}
        onJump={jump}
      />

      {available.map(id => {
        if (id === 'trend') {
          return (
            <Section key={id} {...sectionProps(id)} title="Global Trade and India Trade over Time">
              <TrendSection node={node} year={year} dark={dark} currency={currency} currencyBlock={currencyBlock} />
            </Section>
          )
        }

        if (id === 'world') {
          const importers = rankingFor('importers', node, year, detail)
          const exporters = rankingFor('exporters', node, year, detail)

          return (
            <Section key={id} {...sectionProps(id)} title={`Top Importers and Exporters · ${year}`}>
              {headline.published ? (
                <div className="rf-grid">
                  <RankedTable
                    id="importers"
                    title="Top Importers"
                    rows={importers.rows}
                    count={importers.count}
                    complete={importers.complete}
                    valueLabel="Imports"
                    shareLabel="Share of product trade"
                    formatValue={value => usd(value)}
                    colour={colours.global}
                    highlight="699"
                    pinnedRow={indiaPinned(importers.rows, headline.indiaImportRank, headline.indiaImportShare, record.global.indiaImportPosition?.value ?? null)}
                    onViewAll={() => onViewAll('importers', year)}
                    footnote={importers.basis === 'net' ? 'Net of re-imports' : undefined}
                    dark={dark}
                  />
                  <RankedTable
                    id="exporters"
                    title="Top Exporters"
                    rows={exporters.rows}
                    count={exporters.count}
                    complete={exporters.complete}
                    valueLabel="Exports"
                    shareLabel="Share of product trade"
                    formatValue={value => usd(value)}
                    colour={colours.global}
                    highlight="699"
                    pinnedRow={indiaPinned(exporters.rows, headline.indiaExportRank, headline.indiaExportShare, record.global.indiaExportPosition?.value ?? null)}
                    onViewAll={() => onViewAll('exporters', year)}
                    footnote={exporters.basis === 'net' ? 'Net of re-exports' : undefined}
                    dark={dark}
                  />
                </div>
              ) : (
                <p className="rf-empty">No world ranking for {year}.</p>
              )}
            </Section>
          )
        }

        if (id === 'partners') {
          const suppliers = rankingFor('indiaSuppliers', node, year, detail)
          const destinations = rankingFor('indiaDestinations', node, year, detail)

          return (
            <Section key={id} {...sectionProps(id)} title={`India's Partners · ${year}`}>
              <div className="rf-grid">
                <RankedTable
                  id="india-suppliers"
                  title="India Import Partners"
                  rows={suppliers.rows}
                  count={suppliers.count}
                  complete={suppliers.complete}
                  valueLabel="India imports"
                  shareLabel="Share of India's imports"
                  formatValue={value => india(value)}
                  colour={colours.imports}
                  onViewAll={() => onViewAll('indiaSuppliers', year)}
                  emptyText={`No partner detail for ${year}.`}
                  dark={dark}
                />
                <RankedTable
                  id="india-destinations"
                  title="India Export Partners"
                  rows={destinations.rows}
                  count={destinations.count}
                  complete={destinations.complete}
                  valueLabel="India exports"
                  shareLabel="Share of India's exports"
                  formatValue={value => india(value)}
                  colour={colours.exports}
                  onViewAll={() => onViewAll('indiaDestinations', year)}
                  emptyText={`No partner detail for ${year}.`}
                  dark={dark}
                />
              </div>
            </Section>
          )
        }

        if (id === 'dgcis' && dgcis) {
          return (
            <Section key={id} {...sectionProps(id)} title="India Tariff Lines · HS-8">
              <Safely label="TariffBox">
                <TariffBox data={dgcis} node={node} currency={currency} onOpenHs8={onOpenHs8} />
              </Safely>
            </Section>
          )
        }

        if (id === 'inside') {
          return (
            <Section
              key={id}
              {...sectionProps(id)}
              title={node.level === 2 ? `HS-4 Headings in Chapter ${node.code}` : `HS-6 Lines in Heading ${node.code}`}
            >
              <InsideSection node={node} year={year} children_={children} india={india} onOpen={onOpen} expected={childCodes.length} />
            </Section>
          )
        }

        if (id === 'lineage') {
          return (
            <Section key={id} {...sectionProps(id)} title="Classification History">
              <LineageNote node={node} onOpen={onOpen} carriedInTrend />
            </Section>
          )
        }

        if (id === 'signals') {
          return (
            <Section key={id} {...sectionProps(id)} title={`Key Changes · ${year}`}>
              <KeyChanges node={node} year={year} india={india} />
            </Section>
          )
        }

        return null
      })}

      <footer className="rf-source">
        Source: UN Comtrade (HS {node.level === 6 ? '2022, six-digit' : `${node.level}-digit`}),
        calendar years
        {dgcis ? '; India tariff lines: DGCIS, monthly' : ''}. Snapshot{' '}
        {new Date(manifest.refreshedAt).toLocaleDateString('en-GB')}.
        {node.level === 6 && dgcis === null && (
          <span className="tariff-absent"> No India tariff-line (HS-8) extract is held for this heading.</span>
        )}
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function standingCaption(
  rank: number | null,
  share: number | null,
  noun: 'importers' | 'exporters',
  side: 'imports' | 'exports',
): string {
  if (rank !== null && share !== null) {
    return `${ordinal(rank)} of all ${noun} · ${pct(share, 1)} of world ${side}`
  }

  if (share !== null) return `${pct(share, 1)} of world ${side}`

  return noun === 'importers' ? 'India Import Ranking not published' : 'India Export Ranking not published'
}

function indiaPinned(
  rows: { code: string }[],
  rank: number | null,
  share: number | null,
  value: number | null,
) {
  if (rank === null || value === null || rows.some(row => row.code === '699')) return null

  return { rank, code: '699', name: 'India', value, share, estimated: false }
}

/* ------------------------------------------------------- the drawer */

function CalculationDrawer({
  node,
  year,
  methodology,
  manifest,
}: {
  node: HsNode
  year: number
  methodology: Methodology | null
  manifest: Manifest
}) {
  const record = node.annual[String(year)]

  if (!record) return null

  const global = record.global
  const observed = global.observed
  const estimation = global.estimation?.imports
  const coverage = global.coverage ?? { status: global.tradeStatus }
  const gross = observed.grossImports
  const net = global.trade ?? observed.netImports
  const gap = gross && net !== null ? (gross - net) / gross : null

  const rows: { term: string; value: string; note?: string }[] = [
    {
      term: 'Global Trade, gross',
      value: usd(gross),
      note: 'Every reporting economy’s imports from the world, as filed, plus estimates for economies that have not filed.',
    },
    {
      term: 'Net of re-imports',
      value: usd(net),
      note: `Re-imports subtracted reporter by reporter, where filed separately. ${pct(observed.adjustmentCoverage, 0)} of the total came from reporters that file them.`,
    },
    {
      term: 'Gross–net gap',
      value: gap === null ? '—' : pct(gap, 1),
      note: gap !== null && gap > 0.1 ? 'Above 10%: shown on the page.' : 'Within 10%.',
    },
    {
      term: 'Coverage verdict',
      value: String((coverage as { gateStatus?: string }).gateStatus ?? coverage.status ?? '—'),
      note: [
        coverage.reason,
        coverage.candidateReporters !== undefined && coverage.previousReporters !== undefined
          ? `${coverage.candidateReporters} economies filed, against ${coverage.previousReporters} the year before.`
          : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
    },
    {
      term: 'Estimated',
      value:
        estimation && (estimation.estimatedGrossShare ?? estimation.estimatedShare)
          ? pct(estimation.estimatedGrossShare ?? estimation.estimatedShare, 1)
          : 'None',
      note: estimation
        ? `${plural(estimation.estimatedReporters, 'economy', 'economies')} estimated, ${plural(estimation.filedReporters, 'economy', 'economies')} filed.`
        : undefined,
    },
    {
      term: 'Mirror check',
      value: global.mirror?.gap === null || global.mirror?.gap === undefined ? '—' : delta(global.mirror.gap),
      note: mirrorReading(global.mirror?.gap ?? null),
    },
    {
      term: 'Source',
      value: 'UN Comtrade',
      note: `Snapshot built ${new Date(manifest.refreshedAt).toLocaleDateString('en-GB')}. Calendar year ${year}.`,
    },
  ]

  return (
    <Disclosure summary="How this figure is calculated">
      <dl className="rf-drawer">
        {rows.map(row => (
          <div key={row.term} className="rf-drawer-row">
            <dt>{row.term}</dt>
            <dd>
              <strong>{row.value}</strong>
              {row.note && <span>{row.note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {global.provisional && global.provisional.length > 1 && (
        <ul className="rf-drawer-list">
          {global.provisional.map(reason => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {methodology?.estimation && (
        <div className="rf-drawer-method">
          <strong>Estimation</strong>
          <p>{methodology.estimation.statement}</p>
          <ul>
            {methodology.estimation.notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {node.level === 6 && (
        <p className="rf-drawer-foot">
          India&rsquo;s eight-digit tariff lines are DGCIS data: India reporting its own trade.
          Their partner &ldquo;World&rdquo; means India with everywhere, not world trade, and they
          are never added to these figures.
        </p>
      )}
    </Disclosure>
  )
}

/* ---------------------------------------------------------- trend */

function TrendSection({
  node,
  year,
  dark,
  currency,
  currencyBlock,
}: {
  node: HsNode
  year: number
  dark: boolean
  currency: CurrencyMode
  currencyBlock?: CurrencyBlock
}) {
  const [view, setView] = useState<ChartView>('table')
  const [frequency, setFrequency] = useState<'annual' | 'monthly'>('annual')
  const [series, setSeries] = useState<'world' | 'india'>('world')
  const [all, setAll] = useState(false)

  const colours = palette(dark)

  const years = useMemo(() => [...node.years].sort((a, b) => b - a), [node.years])

  const rows = useMemo(
    () =>
      years.map(item => {
        const record = node.annual[String(item)]
        const published = record?.global.trade !== null && record?.global.trade !== undefined

        return {
          year: item,
          global: published ? record.global.observed.grossImports ?? record.global.trade : null,
          estimated:
            record?.global.estimation?.imports.estimatedGrossShare ??
            record?.global.estimation?.imports.estimatedShare ??
            null,
          reporters: record?.global.estimation?.imports.estimatedReporters ?? null,
          imports: record?.india.imports ?? null,
          exports: record?.india.exports ?? null,
          carried: null as string | null,
        }
      }),
    [node, years],
  )

  /*
   * Retired predecessors (execution prompt §1.8). A year this code has
   * nothing for, but its predecessor reported, shows the predecessor's own
   * figures marked ** - the whole of the old code, never apportioned, and
   * never added to this one.
   */
  const withCarry = useMemo(() => {
    const out = rows.map(row => ({ ...row }))
    const present = new Set(out.map(row => row.year))

    for (const [code, series] of Object.entries(node.lineage?.series ?? {})) {
      for (const [key, values] of Object.entries(series)) {
        const item = Number(key)
        const own = out.find(row => row.year === item)

        if (own && (own.global !== null || own.imports !== null || own.exports !== null)) continue

        const carried = {
          year: item,
          global: values.globalTrade ?? null,
          estimated: null,
          reporters: null,
          imports: values.indiaImports ?? null,
          exports: values.indiaExports ?? null,
          carried: code,
        }

        if (own) Object.assign(own, carried)
        else if (!present.has(item)) {
          out.push(carried)
          present.add(item)
        }
      }
    }

    return out.sort((a, b) => b.year - a.year)
  }, [rows, node.lineage])

  /* Trim empty years at both ends: a line created in 2022 has nothing to
   * say about 1996, and the year in progress has nothing filed yet. */
  const hasData = (row: (typeof withCarry)[number]) =>
    row.global !== null || row.imports !== null || row.exports !== null

  let firstWithData = -1
  let lastWithData = -1

  withCarry.forEach((row, position) => {
    if (!hasData(row)) return

    if (lastWithData < 0) lastWithData = position
    firstWithData = position
  })

  const meaningful = firstWithData >= 0 ? withCarry.slice(lastWithData, firstWithData + 1) : withCarry
  const visible = all ? meaningful : meaningful.slice(0, 10)

  const months = useMemo(() => [...node.months].sort().reverse(), [node.months])

  const india = (value: number | null, period: string, basis: 'CY' | 'MONTH') =>
    money(value, currency, currencyBlock, period, { basis }).text

  /* The chart draws this code's own series only: a predecessor's whole
   * value joined onto a successor's line would read as a collapse. */
  const chartData = useMemo(() => [...meaningful].filter(row => !row.carried).reverse(), [meaningful])
  const anyCarried = visible.some(row => row.carried)

  const worldScale = axisScale(chartData.map(row => row.global), false)
  const indiaScale = axisScale(chartData.flatMap(row => [row.imports, row.exports]), false)

  const monthlyData = useMemo(
    () =>
      [...months].reverse().map(period => ({
        label: monthLabel(period),
        imports: node.monthly[period]?.india.imports ?? null,
        exports: node.monthly[period]?.india.exports ?? null,
      })),
    [months, node.monthly],
  )

  const monthScale = axisScale(monthlyData.flatMap(row => [row.imports, row.exports]), false)

  return (
    <div className="rf-trend">
      <div className="rf-trend-controls">
        <Tabs
          label="Trend view"
          active={view}
          onChange={next => setView(next as ChartView)}
          tabs={[
            { id: 'table', label: 'Table' },
            { id: 'chart', label: 'Chart' },
          ]}
        />

        {node.months.length > 0 && (
          <Segmented<'annual' | 'monthly'>
            label="Frequency"
            value={frequency}
            onChange={setFrequency}
            options={[
              { id: 'annual', label: 'Annual' },
              { id: 'monthly', label: 'Monthly (India)' },
            ]}
          />
        )}

        {view === 'chart' && frequency === 'annual' && (
          <Segmented<'world' | 'india'>
            label="Series"
            value={series}
            onChange={setSeries}
            options={[
              { id: 'world', label: 'Global Trade' },
              { id: 'india', label: 'India Trade' },
            ]}
          />
        )}
      </div>

      {frequency === 'monthly' ? (
        view === 'table' ? (
          <div className="rf-tablewrap">
            <table className="rf-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">India Imports</th>
                  <th scope="col" className="num">India Exports</th>
                </tr>
              </thead>
              <tbody>
                {months.map(period => (
                  <tr key={period}>
                    <td>{monthLabel(period)}</td>
                    <td className="num">{india(node.monthly[period]?.india.imports ?? null, period, 'MONTH')}</td>
                    <td className="num">{india(node.monthly[period]?.india.exports ?? null, period, 'MONTH')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <TrendChart
            data={monthlyData}
            lines={[
              { key: 'imports', name: 'India Imports', colour: colours.imports },
              { key: 'exports', name: 'India Exports', colour: colours.exports },
            ]}
            scale={monthScale}
            colours={colours}
          />
        )
      ) : view === 'table' ? (
        <>
          <div className="rf-tablewrap">
            <table className="rf-table rf-trend-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" className="num">Global Trade</th>
                  <th scope="col" className="num">India Imports</th>
                  <th scope="col" className="num">India Exports</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr
                    key={row.year}
                    className={[row.year === year ? 'rf-emphasis' : '', row.carried ? 'rf-carried' : ''].filter(Boolean).join(' ') || undefined}
                  >
                    <td>
                      {row.year}
                      {row.carried && <span className="rf-carried-code"> · HS {row.carried}</span>}
                    </td>
                    <td className="num">
                      {usd(row.global)}
                      {row.carried ? (
                        <Carried code={row.carried} />
                      ) : (
                        <Estimated share={row.estimated} reporters={row.reporters ?? undefined} />
                      )}
                    </td>
                    <td className="num">
                      {india(row.imports, String(row.year), 'CY')}
                      {row.carried && row.imports !== null && <Carried code={row.carried} />}
                    </td>
                    <td className="num">
                      {india(row.exports, String(row.year), 'CY')}
                      {row.carried && row.exports !== null && <Carried code={row.carried} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meaningful.length > 10 && (
            <button type="button" className="rf-more" onClick={() => setAll(value => !value)}>
              {all ? 'Last 10 years' : `All ${meaningful.length} years`}
            </button>
          )}

          <Markers
            estimated={visible.some(row => (row.estimated ?? 0) > 0)}
            carried={anyCarried}
          />
        </>
      ) : series === 'world' ? (
        <TrendChart
          data={chartData.map(row => ({ label: String(row.year), global: row.global }))}
          lines={[{ key: 'global', name: 'Global Trade', colour: colours.global }]}
          scale={worldScale}
          colours={colours}
        />
      ) : (
        <TrendChart
          data={chartData.map(row => ({ label: String(row.year), imports: row.imports, exports: row.exports }))}
          lines={[
            { key: 'imports', name: 'India Imports', colour: colours.imports },
            { key: 'exports', name: 'India Exports', colour: colours.exports },
          ]}
          scale={indiaScale}
          colours={colours}
        />
      )}
    </div>
  )
}

function Carried({ code }: { code: string }) {
  const detail = `Carried from retired HS ${code}: that code's whole value as reported, not apportioned, and not added to this one.`

  return (
    <abbr className="carried-mark" title={detail} aria-label={detail}>
      **
    </abbr>
  )
}

function TrendChart({
  data,
  lines,
  scale,
  colours,
}: {
  data: Record<string, unknown>[]
  lines: { key: string; name: string; colour: string }[]
  scale: { divisor: number; unit: string; decimals: number }
  colours: ReturnType<typeof palette>
}) {
  return (
    <div className="rf-chart">
      <span className="rf-axis-unit">{scale.unit}</span>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 28, right: 24, bottom: 8, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colours.grid} />
          <XAxis
            dataKey="label"
            tickMargin={8}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 13, fill: colours.axis }}
            minTickGap={14}
          />
          <YAxis
            width={56}
            tickFormatter={value => (Number(value) / scale.divisor).toFixed(scale.decimals)}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 13, fill: colours.axis }}
          />
          <Tooltip
            formatter={(value: unknown) => usd(Number(value))}
            contentStyle={{ background: colours.surface, border: `1px solid ${colours.grid}`, color: colours.text, fontSize: 14 }}
          />
          <Legend verticalAlign="top" align="right" height={30} wrapperStyle={{ fontSize: 14 }} />
          {lines.map(line => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.colour}
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: line.colour }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------ tariff box */

function TariffBox({
  data,
  node,
  currency,
  onOpenHs8,
}: {
  data: DgcisNode
  node: HsNode
  currency: CurrencyMode
  onOpenHs8?: (hs8: string) => void
}) {
  const flows = flowsOf(data)
  const [flow, setFlow] = useState<DgcisFlow>(flows[0] ?? 'exports')

  /* DGCIS files both units, so the rupee view shows INR crore as filed
   * rather than a converted dollar figure. */
  const basis = currency === 'INR' ? 'inr' : 'usd'
  const unit = unitLabel(basis)

  const tiles = useMemo(() => {
    const parent = totalSeries(data, flow, basis)

    return data.lines
      .filter(line => line && typeof line.hs8 === 'string')
      .map(line => {
        const series = seriesFor(data, flow, line.hs8, basis)

        if (!series) return null

        return {
          line,
          twelve: last12(series),
          latest: latestOf(series, data.periods),
          share: shareOfParent(series, parent),
          change: rollingChange(series),
        }
      })
      .filter((tile): tile is NonNullable<typeof tile> => tile !== null)
      .sort((a, b) => (b.twelve ?? 0) - (a.twelve ?? 0))
  }, [data, flow, basis])

  if (!tiles.length) return <p className="rf-empty">No tariff-line detail for this flow.</p>

  return (
    <div className="rf-tariff dgcis" data-flow={flow}>
      <div className="rf-tariff-head">
        <p className="rf-tariff-lede">
          India&rsquo;s {flowWord(flow).toLowerCase()}, by tariff line · {plural(tiles.length, 'line')} · last 12
          months to {formatPeriod(data.periods[data.periods.length - 1] ?? null)} · {unit}
        </p>

        {flows.length > 1 && (
          <Segmented<DgcisFlow>
            label="Flow"
            value={flow}
            onChange={setFlow}
            options={flows.map(option => ({ id: option, label: flowWord(option) }))}
          />
        )}
      </div>

      <div className="rf-tariff-grid">
        {tiles.map(tile => (
          <button
            key={tile.line.hs8}
            type="button"
            className="rf-tariff-tile"
            onClick={() => onOpenHs8?.(tile.line.hs8)}
            title={`Open tariff line ${tile.line.hs8}`}
          >
            <span className="rf-tariff-code">{tile.line.hs8}</span>
            <span className="rf-tariff-name">
              {tile.line.title || tile.line.principalCommodity || `Tariff line ${tile.line.hs8}`}
            </span>
            <span className="rf-tariff-value">
              {formatValue(tile.twelve)}
              <small> {unit}, 12 months</small>
            </span>
            <span className="rf-tariff-meta">
              {tile.share !== null ? `${(tile.share * 100).toFixed(1)}% of heading` : 'share —'}
              {tile.change !== null ? ` · ${tile.change >= 0 ? '▲' : '▼'} ${Math.abs(tile.change * 100).toFixed(1)}% on prior 12` : ''}
            </span>
          </button>
        ))}
      </div>

      <p className="rf-source-line">
        Source: DGCIS, India reporting its own trade, partner World, {flowWord(flow).toLowerCase()}. Not
        world trade; never added to the Comtrade figures above.{node.lineage?.retired ? ' This code is retired; its lines remain as India history.' : ''}
      </p>
    </div>
  )
}

/* -------------------------------------------------------- inside */

function InsideSection({
  node,
  year,
  children_,
  india,
  onOpen,
  expected,
}: {
  node: HsNode
  year: number
  children_: HsNode[]
  india: (value: number | null | undefined) => string
  onOpen: (code: string, level: 2 | 4 | 6) => void
  expected: number
}) {
  const period = String(year)
  const heading = node.annual[period]
  const headingGross = heading?.global.trade !== null && heading?.global.trade !== undefined
    ? heading.global.observed.grossImports ?? heading.global.trade
    : null

  const rows = children_
    .map(child => {
      const record = child.annual[period]
      const published = record?.global.trade !== null && record?.global.trade !== undefined

      return {
        code: child.code,
        level: child.level,
        name: nameOf(child),
        world: published ? record!.global.observed.grossImports ?? record!.global.trade : null,
        estimated: record?.global.estimation?.imports.estimatedGrossShare ?? record?.global.estimation?.imports.estimatedShare ?? null,
        imports: record?.india.imports ?? null,
        exports: record?.india.exports ?? null,
      }
    })
    .sort((a, b) => (b.world ?? -1) - (a.world ?? -1))

  const coverage = buildCoverage(node, year)

  /* A chapter can hold sixty headings. The ten largest answer the question
   * the section asks; the rest are one tap away and all in the workbook. */
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 10)

  if (!children_.length) {
    return <p className="rf-empty">{expected > 60 ? `${expected} codes; open one from search.` : 'Loading…'}</p>
  }

  return (
    <>
      <div className="rf-tablewrap">
        <table className="rf-table contribution">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col" className="num">Global Trade</th>
              <th scope="col" className="num">Share of HS-{node.level} {node.code}</th>
              <th scope="col" className="num">India Exports</th>
              <th scope="col" className="num">India Imports</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <tr key={row.code}>
                <td className="rf-code">{row.code}</td>
                <td className="rf-name">
                  <button type="button" className="rf-link" onClick={() => onOpen(row.code, row.level)}>
                    {row.name}
                  </button>
                </td>
                <td className="num">
                  {usd(row.world)}
                  <Estimated share={row.estimated} />
                </td>
                <td className="num">{row.world !== null && headingGross ? pct(row.world / headingGross, 1) : '—'}</td>
                <td className="num">{india(row.exports)}</td>
                <td className="num">{india(row.imports)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                HS-{node.level} {node.code} total
              </th>
              <td className="num">{usd(headingGross)}</td>
              <td className="num">100%</td>
              <td className="num">{india(heading?.india.exports)}</td>
              <td className="num">{india(heading?.india.imports)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length > 10 && (
        <button type="button" className="rf-more" onClick={() => setAll(value => !value)}>
          {all ? 'Largest 10' : `All ${rows.length} ${node.level === 2 ? 'headings' : 'lines'}`}
        </button>
      )}

      {coverage.length > 0 && (
        <ul className="rf-notes">
          {coverage.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ---------------------------------------------------- key changes */

function KeyChanges({
  node,
  year,
  india,
}: {
  node: HsNode
  year: number
  india: (value: number | null | undefined) => string
}) {
  const current = node.annual[String(year)]
  const prior = node.annual[String(year - 1)]

  if (!current) return null

  const change = (now: number | null | undefined, before: number | null | undefined) =>
    now != null && before ? delta(now / before - 1) : '—'

  const grossOf = (record: typeof current | undefined) =>
    record && record.global.trade !== null ? record.global.observed.grossImports ?? record.global.trade : null

  const suppliers = current.india.suppliers

  const rows: [string, string][] = [
    [`Global Trade, ${year - 1} to ${year}`, change(grossOf(current), grossOf(prior))],
    [`India Exports, ${year - 1} to ${year}`, change(current.india.exports, prior?.india.exports)],
    [`India Imports, ${year - 1} to ${year}`, change(current.india.imports, prior?.india.imports)],
    ['India trade balance', india(current.india.balance)],
  ]

  if (suppliers?.rows[0]) {
    rows.push(['Largest import source', `${suppliers.rows[0].name}, ${pct(suppliers.rows[0].share, 1)}`])
  }

  if (suppliers?.top3Share != null) {
    rows.push(['Top three import sources', pct(suppliers.top3Share, 1)])
  }

  return (
    <dl className="rf-keys">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
