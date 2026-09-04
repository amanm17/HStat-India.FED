import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Moon, Pin, Sun } from 'lucide-react'

import type {
  CatalogueEntry,
  CurrencyMode,
  HsNode,
  Manifest,
  Methodology,
  SearchItem,
} from './types'

import {
  loadCatalogue,
  loadHsNodes,
  loadHsNode,
  loadFxRates,
  loadManifest,
  loadMethodology,
  loadSearch,
  type SnapshotName,
} from './lib/data'

import {
  buildIndex,
  readRecentSearches,
  saveRecentSearch,
} from './lib/search'

import {
  readBasket,
  saveBasket,
  type BasketEntry,
} from './lib/hstack'

import { useFallbackRates } from './lib/currency'
import { SearchHub } from './components/SearchHub'
import { ProductView } from './components/ProductView'
import { HStackPanel } from './components/HStackPanel'
import { Sidebar } from './components/Sidebar'

import {
  noteVisit,
  readWorkspace,
  removeReport,
  renameReport,
  saveReport,
  toggleTile,
  togglePin,
  touchReport,
  writeWorkspace,
  DEFAULT_TILES,
  arrangeSlides,
  moveTile,
  resetLayout,
  visibleTiles,
  TILES,
  type ReportScope,
  type SavedReport,
  type Workspace,
} from './lib/workspace'

import { reportToPdf, reportToPng } from './lib/report'

const DEFAULT_CODE = '851713'

/*
 * The 2.0 dashboard reads a 2.0 snapshot. Deploying the new frontend over
 * a snapshot built by the old pipeline would otherwise fail with a wall of
 * console errors and an empty page; this says what to run instead.
 */
const SCHEMA = '2.0.0'

function App() {
  const [snapshot, setSnapshot] = useState<SnapshotName>('current')
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([])
  const [methodology, setMethodology] = useState<Methodology | null>(null)
  const [library, setLibrary] = useState<SearchItem[]>([])

  const [node, setNode] = useState<HsNode | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [recent, setRecent] = useState<string[]>([])
  const [dark, setDark] = useState(false)

  /*
   * Two viewing modes, both in the topbar where the 1.x "IND" button used to
   * sit. HS-8 pulls India's tariff-line detail up through the page instead of
   * leaving it stranded at the bottom; the currency switch reads the same
   * figures in rupees. Neither changes any number - they change what is shown
   * and in which unit, and every block keeps saying which period it is on.
   */
  const [showHs8, setShowHs8] = useState(false)
  const [currency, setCurrency] = useState<CurrencyMode>('USD')

  /*
   * The reader's own state: pins, history, which tiles they keep, and their
   * report library. Local to this browser and never sent anywhere.
   */
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    pinned: [],
    recent: [],
    hiddenTiles: [],
    order: DEFAULT_TILES,
    merged: [],
    autoPack: true,
    view: 'report',
    sidebarOpen: false,
    reports: [],
  }))

  /* Tiles a report needs that the reader has taken off the page. They are
   * put back just long enough to be captured, then removed again. */
  const [forced, setForced] = useState<string[]>([])

  const [reportBusy, setReportBusy] = useState(false)
  const [reportScope, setReportScope] = useState<ReportScope>('product')
  const [flash, setFlash] = useState<string | null>(null)

  const [basket, setBasket] = useState<BasketEntry[]>([])
  const [basketNodes, setBasketNodes] = useState<HsNode[]>([])
  const [basketLoading, setBasketLoading] = useState(false)
  const [stackOpen, setStackOpen] = useState(false)

  const index = useMemo(() => buildIndex(library), [library])

  /*
   * The toggle is offered only when there is something behind it. Nothing is
   * more confusing than a control that does nothing, and a snapshot with no
   * DGCIS file is the normal state until one is supplied.
   */
  const tariffAvailable = Boolean(manifest?.tariffLines?.present)

  useEffect(() => {
    if (!tariffAvailable) setShowHs8(false)
  }, [tariffAvailable])

  const inBasket = useCallback(
    (code: string) => basket.some(entry => entry.code === code),
    [basket],
  )

  useEffect(() => {
    setRecent(readRecentSearches())

    setBasket(readBasket())

    setWorkspace(readWorkspace())

    ;(async () => {
      const loaded = await loadManifest()

      setManifest(loaded.manifest)
      setSnapshot(loaded.snapshot)

      const [entries, terms, method, fx] = await Promise.all([
        loadCatalogue(loaded.snapshot),
        loadSearch(),
        loadMethodology(loaded.snapshot),
        loadFxRates(),
      ])

      /* Registered before the first render that can ask for rupees. */
      useFallbackRates(fx?.rates ?? null)

      setCatalogue(entries)
      setLibrary(terms)
      setMethodology(method)

      const opening =
        entries.find(entry => entry.code === DEFAULT_CODE) ??
        entries.find(entry => entry.level === 6 && entry.globalTrade !== null) ??
        entries[0]

      if (opening) {
        const first = await loadHsNode(
          loaded.snapshot,
          opening.code,
          opening.level,
        )

        setNode(first)
        setYear(first.latestIndiaYear ?? Math.max(...first.years))
      }
    })().catch(reason => {
      console.error(reason)
      setError(String(reason))
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    writeWorkspace(workspace)
  }, [workspace])

  /* The rail sits over the page on narrow screens and beside it on wide
   * ones. The page needs to know which, so it can give the rail room rather
   * than have its right-hand column disappear underneath it. */
  useEffect(() => {
    document.documentElement.dataset.view = workspace.view
  }, [workspace.view])

  useEffect(() => {
    if (workspace.sidebarOpen) {
      document.documentElement.dataset.rail = 'open'
    } else {
      delete document.documentElement.dataset.rail
    }
  }, [workspace.sidebarOpen])

  useEffect(() => {
    if (!flash) return

    const timer = window.setTimeout(() => setFlash(null), 4200)

    return () => window.clearTimeout(timer)
  }, [flash])

  /* Drives the tariff-line emphasis rules already in the stylesheet. */
  useEffect(() => {
    if (showHs8) {
      document.documentElement.dataset.india = 'active'
    } else {
      delete document.documentElement.dataset.india
    }
  }, [showHs8])

  useEffect(() => {
    saveBasket(basket)

    if (!basket.length) {
      setBasketNodes([])
      return
    }

    let cancelled = false

    setBasketLoading(true)

    loadHsNodes(snapshot, basket)
      .then(loaded => {
        if (!cancelled) setBasketNodes(loaded)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setBasketLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [basket, snapshot])

  const openCode = useCallback(
    async (code: string, level: 2 | 4 | 6) => {
      try {
        const next = await loadHsNode(snapshot, code, level)

        setNode(next)
        setYear(next.latestIndiaYear ?? Math.max(...next.years))
        setStackOpen(false)

        setWorkspace(current =>
          noteVisit(current, {
            code: next.code,
            level: next.level,
            label: next.product || next.description,
          }),
        )

        saveRecentSearch(code)
        setRecent(readRecentSearches())

        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (reason) {
        console.error(`Failed to open HS-${level} ${code}`, reason)
      }
    },
    [snapshot],
  )

  const addToBasket = useCallback((entry: BasketEntry) => {
    setBasket(current =>
      current.some(item => item.code === entry.code)
        ? current
        : [...current, entry],
    )
  }, [])

  const removeFromBasket = useCallback((code: string) => {
    setBasket(current => current.filter(entry => entry.code !== code))
  }, [])

  /* Tiles the page is currently showing: the reader's choice, plus anything
   * a report is capturing right now. */
  const hiddenTiles = useMemo(
    () => workspace.hiddenTiles.filter(id => !forced.includes(id)),
    [workspace.hiddenTiles, forced],
  )

  const reportSubject = useMemo(() => {
    if (reportScope === 'hstack') {
      return basket.length
        ? `${basket.length} codes in HStack`
        : 'Nothing stacked yet'
    }

    return node ? `${node.product || node.description} · HS-${node.level} ${node.code}` : ''
  }, [reportScope, basket, node])

  /*
   * Rendering a report.
   *
   * Tiles are captured from the live page, so anything the report asks for
   * that the reader has taken off has to be put back first. React needs a
   * paint for that, and Recharts needs a beat after it to lay an axis out, so
   * the wait is deliberate rather than superstitious.
   */
  const runReport = useCallback(
    async (
      name: string,
      tiles: string[],
      format: 'pdf' | 'png',
      scope: ReportScope,
      forYear: number,
      remember: boolean,
    ) => {
      if (!node || !manifest || forYear === null) return

      setReportBusy(true)

      const missing = tiles.filter(id => workspace.hiddenTiles.includes(id))

      if (missing.length) setForced(missing)

      await new Promise(resolve => window.setTimeout(resolve, missing.length ? 900 : 350))

      const subject =
        scope === 'hstack'
          ? `HStack · ${basket.length} codes`
          : `${node.product || node.description} · HS-${node.level} ${node.code}`

      const title = name.trim() || `HStat report — ${subject}`

      const chosen = TILES.filter(tile => tiles.includes(tile.id)).map(tile => ({
        id: tile.id,
        label: tile.label,
      }))

      try {
        const header = {
          title,
          subtitle: subject,
          meta: [
            `Calendar year ${forYear} · figures in ${currency === 'INR' ? 'rupees where a rate exists' : 'US dollars'}`,
            `Source: UN Comtrade · snapshot built ${new Date(manifest.refreshedAt).toLocaleDateString()}`,
            'Global trade is every reporting economy\'s imports from the world, less re-imports. Valued CIF.',
          ],
        }

        const ok =
          format === 'pdf'
            ? await reportToPdf(header, chosen)
            : await reportToPng(header, chosen)

        if (!ok) {
          setFlash('Nothing could be captured — the chosen tiles are not on this page.')
        } else if (remember) {
          setWorkspace(current => {
            const { workspace: next } = saveReport(current, {
              name: title,
              scope,
              code: node.code,
              level: node.level,
              subject,
              year: forYear,
              currency,
              tiles,
            })

            return next
          })

          setFlash('Report saved to your library.')
        } else {
          setFlash('Report downloaded.')
        }
      } catch (reason) {
        console.error(reason)
        setFlash('The report could not be rendered.')
      } finally {
        setForced([])
        setReportBusy(false)
      }
    },
    [node, manifest, basket, currency, workspace.hiddenTiles],
  )

  if (error) {
    return (
      <div className="boot">
        <strong>HStat.India</strong>
        <p>Could not load the snapshot. {error}</p>
      </div>
    )
  }

  if (manifest && manifest.schemaVersion !== SCHEMA) {
    return (
      <div className="boot">
        <strong>HStat.India</strong>

        <p>
          The published snapshot is schema{' '}
          {manifest.schemaVersion ?? 'unknown'}; this build reads {SCHEMA}.
        </p>

        <p>
          Run <code>python pipeline/refresh_monthly.py</code> to rebuild it, or{' '}
          <code>./scripts/dev-fixture.sh</code> for a synthetic one.
        </p>
      </div>
    )
  }

  if (!manifest || !node || year === null) {
    return <div className="boot">HStat.India</div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="identity">
          <div className="brand">
            HStat.<strong>India</strong>
          </div>

          <div className="refresh">
            {manifest.products} products · updated{' '}
            {new Date(manifest.refreshedAt).toLocaleDateString()}
            {snapshot === 'previous' && ' · showing last validated snapshot'}
          </div>
        </div>

        <SearchHub
          variant="bar"
          index={index}
          recent={recent}
          inBasket={inBasket}
          onOpen={item => {
            if (item.retired) return

            openCode(item.code, item.level)
          }}
          onAdd={item => addToBasket({ code: item.code, level: item.level })}
        />

        <div className="toggles">
          {/*
            * A control that cannot do anything is worse than no control: it
            * reads as a broken feature rather than an absent one. Tariff
            * lines arrive with a DGCIS file, and until one does the toggle
            * simply is not part of the interface. The panel at the foot of
            * the product page is where the absence gets explained, in one
            * line, to whoever goes looking for it.
            */}
          {tariffAvailable && (
            <button
              className={showHs8 ? 'ind-toggle active' : 'ind-toggle'}
              aria-pressed={showHs8}
              title="Show India ITC(HS)-8 tariff-line detail alongside the six-digit figures"
              onClick={() => setShowHs8(value => !value)}
            >
              HS-8
            </button>
          )}

          <button
            className="currency-toggle"
            aria-label={
              currency === 'USD'
                ? 'Show India figures in rupees'
                : 'Show India figures in US dollars'
            }
            title={
              currency === 'USD'
                ? 'Show India and tariff-line figures in rupees'
                : 'Show India and tariff-line figures in US dollars'
            }
            onClick={() =>
              setCurrency(value => (value === 'USD' ? 'INR' : 'USD'))
            }
          >
            <span className={currency === 'USD' ? 'active' : ''}>$</span>
            <span className="divider">/</span>
            <span className={currency === 'INR' ? 'active' : ''}>₹</span>
          </button>

          {/*
            * Two ways of reading the same tiles. Report View is the page to
            * read through; Glance View is the same tiles as slides to move
            * across when you already know what you are after.
            */}
          <div className="viewswitch" role="group" aria-label="View mode">
            {(['report', 'glance'] as const).map(mode => (
              <button
                key={mode}
                className={workspace.view === mode ? 'active' : ''}
                aria-pressed={workspace.view === mode}
                title={
                  mode === 'report'
                    ? 'Report view — everything stacked, read top to bottom'
                    : 'Glance view — one panel at a time, move across with the arrows'
                }
                onClick={() =>
                  setWorkspace(current => ({ ...current, view: mode }))
                }
              >
                {mode === 'report' ? 'Report' : 'Glance'}
              </button>
            ))}
          </div>

          <button
            className={basket.length ? 'stack-toggle active' : 'stack-toggle'}
            onClick={() => setStackOpen(true)}
            title="Open HStack"
          >
            <Layers size={16} />
            HStack
            {basket.length > 0 && (
              <span className="stack-count">{basket.length}</span>
            )}
          </button>

          <button
            title={dark ? 'Light theme' : 'Dark theme'}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main>
        <ProductView
          workspace={workspace}
          onReorder={(dragged, before) =>
            setWorkspace(current => moveTile(current, dragged, before))
          }
          onArrange={groups =>
            setWorkspace(current => arrangeSlides(current, groups))
          }
          onAuto={() =>
            setWorkspace(current => ({
              ...current,
              autoPack: true,
              merged: [],
            }))
          }
          /*
           * Changing the year says the year is what you came for, so it
           * takes the lead slot - but only by moving ahead of the world
           * market card, and only when it is not already there. It is an
           * ordinary reorder, so a reader who has arranged the page
           * deliberately keeps their arrangement.
           */
          onYearLead={() =>
            setWorkspace(current => {
              const year = current.order.indexOf('year')
              const global = current.order.indexOf('global')

              if (year < 0 || global < 0 || year < global) return current

              return moveTile(current, 'year', 'global')
            })
          }
          hiddenTiles={hiddenTiles}
          onUnpinTile={id =>
            setWorkspace(current => toggleTile(current, id))
          }
          pinned={workspace.pinned.some(entry => entry.code === node.code)}
          onTogglePin={() =>
            setWorkspace(current =>
              togglePin(current, {
                code: node.code,
                level: node.level,
                label: node.product || node.description,
              }),
            )
          }
          node={node}
          year={year}
          onYearChange={setYear}
          methodology={methodology}
          dark={dark}
          showHs8={showHs8}
          currency={currency}
          currencyBlock={manifest.currency}
          snapshot={snapshot}
          catalogue={catalogue}
          inBasket={inBasket(node.code)}
          onOpen={openCode}
          onAddToStack={() =>
            addToBasket({ code: node.code, level: node.level })
          }
        />
      </main>

      <Sidebar
        workspace={workspace}
        onReorderTile={(dragged, before) =>
          setWorkspace(current => moveTile(current, dragged, before))
        }
        currentCode={node.code}
        subject={reportSubject}
        hasStack={basket.length > 0}
        busy={reportBusy}
        scope={reportScope}
        onScope={setReportScope}
        onToggle={() =>
          setWorkspace(current => ({
            ...current,
            sidebarOpen: !current.sidebarOpen,
          }))
        }
        onOpen={openCode}
        onUnpin={id => setWorkspace(current => toggleTile(current, id))}
        onResetLayout={() => {
          setWorkspace(current => resetLayout(current))
          setFlash('Tiles and slides are back to how they ship.')
        }}
        onTogglePin={entry => setWorkspace(current => togglePin(current, entry))}
        onGenerate={(name, tiles, format) =>
          runReport(name, tiles, format, reportScope, year, true)
        }
        onRunReport={async (report: SavedReport, action) => {
          /* "View again" is not a download: it puts the page back into the
           * state the report was built from, so the reader can read it live
           * and see figures that may have been revised since. */
          if (report.code && report.code !== node.code) {
            await openCode(report.code, (report.level ?? 6) as 2 | 4 | 6)
          }

          setYear(report.year)

          setWorkspace(current => ({
            ...current,
            hiddenTiles: TILES.filter(
              tile => !tile.always && !report.tiles.includes(tile.id),
            ).map(tile => tile.id),
          }))

          if (action === 'view') {
            setFlash(`Showing ${report.name} as it was built.`)
            return
          }

          setWorkspace(current => touchReport(current, report.id))

          await runReport(
            report.name,
            report.tiles,
            action,
            report.scope,
            report.year,
            false,
          )
        }}
        onRenameReport={(id, name) =>
          setWorkspace(current => renameReport(current, id, name))
        }
        onRemoveReport={id =>
          setWorkspace(current => removeReport(current, id))
        }
      />

      {flash && <div className="flash" role="status">{flash}</div>}

      {stackOpen && (
        <HStackPanel
          entries={basket}
          nodes={basketNodes}
          loading={basketLoading}
          dark={dark}
          onAdd={(code, level) => addToBasket({ code, level })}
          onRemove={removeFromBasket}
          onClear={() => setBasket([])}
          onOpen={openCode}
          onClose={() => setStackOpen(false)}
        />
      )}

      {catalogue.length === 0 && (
        <div className="coverage-note">Catalogue is empty.</div>
      )}
    </div>
  )
}

export default App
