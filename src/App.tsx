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
import { loadDgcisIndex } from './lib/dgcis'
import { nameOf } from './lib/format'
import { SearchHub, type Command } from './components/SearchHub'
import { ProductView } from './components/ProductView'
import { Hs8View } from './components/Hs8View'
import { TariffLines } from './components/TariffLines'
import { Guide } from './components/Guide'
import { NavRail } from './components/NavRail'
import { Safely } from './components/Safely'
import { HomeView } from './components/HomeView'
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

/*
 * Routing.
 *
 * The app had none: it opened on one hard-coded product, the URL never
 * changed, and nobody could be sent a link to anything. Two routes are enough
 * - the front door, and a product - and the History API is enough to serve
 * them. The worker already falls back to index.html for unknown paths, so a
 * deep link works on a cold load.
 */
type Route =
  | { kind: 'home' }
  | { kind: 'product'; code: string; level: 2 | 4 | 6 }
  /*
   * An Indian tariff line. Its own route rather than a fourth product level,
   * because it is a different measurement: India reporting India, from DGCIS,
   * with no world figure behind it. Giving it a level of 8 would have let it
   * flow into code paths that assume a Comtrade node exists.
   */
  | { kind: 'tariff'; hs8: string }
  /* Two places rather than pages about a code: the whole tariff-line index,
   * and the written guide. Both are reachable by URL so they can be sent. */
  | { kind: 'lines' }
  | { kind: 'guide' }

function levelOf(code: string): 2 | 4 | 6 {
  return code.length === 2 ? 2 : code.length === 4 ? 4 : 6
}

function routeFromPath(path: string): Route {
  if (/^\/tariff-lines\/?$/.test(path)) return { kind: 'lines' }
  if (/^\/guide\/?$/.test(path)) return { kind: 'guide' }

  const match = /^\/hs\/(\d{2}|\d{4}|\d{6}|\d{8})\/?$/.exec(path)

  if (!match) return { kind: 'home' }

  return match[1].length === 8
    ? { kind: 'tariff', hs8: match[1] }
    : { kind: 'product', code: match[1], level: levelOf(match[1]) }
}

function pathFor(route: Route): string {
  if (route.kind === 'lines') return '/tariff-lines'
  if (route.kind === 'guide') return '/guide'
  if (route.kind === 'tariff') return `/hs/${route.hs8}`

  return route.kind === 'product' ? `/hs/${route.code}` : '/'
}

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

  const [route, setRoute] = useState<Route>(() =>
    routeFromPath(window.location.pathname),
  )
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

    const current = routeFromPath(window.location.pathname)

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

      /* A deep link decides what opens. Anything else lands on the front
       * door, which is also what an unrecognised code falls back to. A
       * tariff-line route carries no catalogue entry by design - its page
       * checks the DGCIS index for itself and says so if the code is not
       * held - so it is left alone here. */
      const wanted =
        current.kind === 'product'
          ? entries.find(entry => entry.code === current.code)
          : undefined

      if (current.kind === 'product' && !wanted) {
        setRoute({ kind: 'home' })
        window.history.replaceState({}, '', '/')
      }

      if (wanted) {
        const first = await loadHsNode(
          loaded.snapshot,
          wanted.code,
          wanted.level,
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

        const target: Route = { kind: 'product', code: next.code, level: next.level }

        setRoute(target)

        if (window.location.pathname !== pathFor(target)) {
          window.history.pushState({}, '', pathFor(target))
        }

        setWorkspace(current =>
          noteVisit(current, {
            code: next.code,
            level: next.level,
            label: nameOf(next),
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

  /*
   * Opening a tariff line.
   *
   * No snapshot fetch: an HS-8 page loads its parent's DGCIS file itself, and
   * the Comtrade node stays as it was so that going back up to the heading is
   * instant rather than a second round trip.
   */
  const openHs8 = useCallback((hs8: string) => {
    const target: Route = { kind: 'tariff', hs8 }

    /* Into history like any other page. The label is the heading's, clearly
     * the heading's - the rail shows the code as the identity. */
    loadDgcisIndex().then(index => {
      const line = index?.lines.find(item => item.hs8 === hs8)

      setWorkspace(current =>
        noteVisit(current, {
          code: hs8,
          level: 8,
          label: line?.title || line?.headingName || 'Tariff line',
        }),
      )
    })

    setRoute(target)
    setStackOpen(false)

    if (window.location.pathname !== pathFor(target)) {
      window.history.pushState({}, '', pathFor(target))
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /*
   * Open whatever a saved reference points at.
   *
   * Pins, history and saved reports all store {code, level}, and level 8 is a
   * tariff line rather than a Comtrade product. One dispatcher means every
   * surface that can hand back a reference - the left rail, the right rail, a
   * report - opens it correctly without each one re-deciding.
   */
  const openRef = useCallback(
    (code: string, level: 2 | 4 | 6 | 8) => {
      if (level === 8) {
        openHs8(code)
        return
      }

      void openCode(code, level)
    },
    [openCode, openHs8],
  )

  const goTo = useCallback((target: Route) => {
    setRoute(target)
    setStackOpen(false)

    if (window.location.pathname !== pathFor(target)) {
      window.history.pushState({}, '', pathFor(target))
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const goHome = useCallback(() => {
    setRoute({ kind: 'home' })
    setStackOpen(false)

    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/')
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  /*
   * What "/" can do.
   *
   * Deliberately only things a reader would otherwise have to hunt for: a
   * place to go, a mode to flip, a report to start. Nothing here is a new
   * capability - it is the same controls, reachable without knowing which
   * corner of the screen they live in.
   */
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'home', label: 'Front page', hint: 'the product catalogue and the search box',
        terms: ['start', 'index'], run: goHome },
      { id: 'lines', label: 'All tariff lines', hint: "India's 543 eight-digit lines, largest first",
        terms: ['hs8', 'tariff', 'eight'], run: () => goTo({ kind: 'lines' }) },
      { id: 'guide', label: 'How to read this dashboard', hint: 'what each source means, and what not to add together',
        terms: ['help', 'explain', 'how'], run: () => goTo({ kind: 'guide' }) },
      { id: 'theme', label: dark ? 'Light theme' : 'Dark theme', hint: 'switch the colour scheme',
        terms: ['dark', 'light'], run: () => setDark(value => !value) },
    ]

    if (node) {
      list.push(
        { id: 'report', label: 'Build a report from this page', hint: 'opens the report builder in the right rail',
          terms: ['pdf', 'png', 'export'],
          run: () => setWorkspace(current => ({ ...current, sidebarOpen: true })) },
        { id: 'pin', label: `Pin ${node.code}`, hint: 'keep it in the left rail',
          terms: ['bookmark', 'save'],
          run: () => setWorkspace(current =>
            togglePin(current, { code: node.code, level: node.level, label: nameOf(node) })) },
        { id: 'currency', label: currency === 'USD' ? 'Show rupees' : 'Show dollars',
          hint: 'India figures only; nothing is converted', terms: ['inr', 'usd', 'rupee'],
          run: () => setCurrency(value => (value === 'USD' ? 'INR' : 'USD')) },
        { id: 'stack', label: 'Open HStack', hint: 'compare the codes you have collected',
          terms: ['compare', 'basket'], run: () => setStackOpen(true) },
      )
    }

    return list
  }, [dark, node, currency, goHome, goTo])

  /* Back and forward have to work, or the URL is decoration. */
  useEffect(() => {
    function onPop() {
      const next = routeFromPath(window.location.pathname)

      setRoute(next)

      if (next.kind !== 'product') return

      if (next.kind === 'product' && next.code !== node?.code) {
        loadHsNode(snapshot, next.code, next.level)
          .then(loadedNode => {
            setNode(loadedNode)
            setYear(
              loadedNode.latestIndiaYear ?? Math.max(...loadedNode.years),
            )
          })
          .catch(console.error)
      }
    }

    window.addEventListener('popstate', onPop)

    return () => window.removeEventListener('popstate', onPop)
  }, [snapshot, node?.code])

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

    return node ? `${nameOf(node)} · HS-${node.level} ${node.code}` : ''
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
          : `${nameOf(node)} · HS-${node.level} ${node.code}`

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

  if (!manifest) {
    return <div className="boot">HStat.India</div>
  }

  /* The product route needs a node; the front door does not. */
  /*
   * Three pages, and the difference matters to the header.
   *
   * A tariff-line page is not the front door - the search bar belongs on it -
   * but it is not a product page either: the HS-8, currency and view controls
   * all act on Comtrade tiles that a tariff-line page does not have, and a
   * control that acts on nothing reads as a broken feature.
   */
  const onTariff = route.kind === 'tariff'
  const onLines = route.kind === 'lines'
  const onGuide = route.kind === 'guide'
  const onProduct =
    !onTariff && !onLines && !onGuide && route.kind === 'product' && !!node && year !== null
  const showHome = !onTariff && !onLines && !onGuide && !onProduct

  return (
    <div className="app">
      <header className="topbar">
        <div className="identity">
          <button
            type="button"
            className="brand"
            onClick={goHome}
            aria-label="HStat.India home"
            title="Back to the front page"
          >
            HStat.<strong>India</strong>
          </button>

          <div className="refresh">
            {manifest.products} products · updated{' '}
            {new Date(manifest.refreshedAt).toLocaleDateString()}
            {snapshot === 'previous' && ' · showing last validated snapshot'}
          </div>
        </div>

        {/*
          * The front page has its own search in the middle of the screen, and
          * a second one in the header three centimetres above it asked the
          * reader which of two identical boxes to use. On a product page the
          * header bar is the only way to move to another code, so it stays.
          */}
        {!showHome && (
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
            onOpenHs8={openHs8}
            commands={commands}
          />
        )}

        <div className="toggles">
          {/*
            * A control that cannot do anything is worse than no control: it
            * reads as a broken feature rather than an absent one. Tariff
            * lines arrive with a DGCIS file, and until one does the toggle
            * simply is not part of the interface. The panel at the foot of
            * the product page is where the absence gets explained, in one
            * line, to whoever goes looking for it.
            */}
          {tariffAvailable && onProduct && (
            <button
              className={showHs8 ? 'ind-toggle active' : 'ind-toggle'}
              aria-pressed={showHs8}
              title="Show India ITC(HS)-8 tariff-line detail alongside the six-digit figures"
              onClick={() => setShowHs8(value => !value)}
            >
              HS-8
            </button>
          )}

          {/*
            * Currency and view mode both act on a product page's tiles. On the
            * front page there is nothing for either to change, so they read as
            * controls that do not work.
            */}
          {onProduct && (
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
          )}

          {/*
            * Two ways of reading the same tiles. Report View is the page to
            * read through; Glance View is the same tiles as slides to move
            * across when you already know what you are after.
            */}
          {onProduct && (
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
          )}

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

      <NavRail
        pinned={workspace.pinned}
        recent={workspace.recent}
        onHome={goHome}
        onOpen={ref => openRef(ref.code, ref.level)}
        onSearch={() => {
          const input = document.querySelector<HTMLInputElement>('.search-hub input')

          if (input) {
            input.focus()
            return
          }

          /* No search box on this page: the front door has one. */
          goHome()
        }}
        onGuide={() => goTo({ kind: 'guide' })}
        onTariffLines={() => goTo({ kind: 'lines' })}
        active={route.kind === 'product' ? route.code : route.kind === 'tariff' ? route.hs8 : null}
      />

      <main>
        {onLines ? (
          <Safely label="TariffLines">
            <TariffLines onOpenHs8={openHs8} onOpen={openCode} />
          </Safely>
        ) : onGuide ? (
          <Safely label="Guide">
            <Guide
              onHome={goHome}
              onOpen={openCode}
              onLines={() => goTo({ kind: 'lines' })}
            />
          </Safely>
        ) : onTariff ? (
          /*
           * Wrapped, like every other piece of the tariff-line work: if this
           * page cannot render, the reader gets a way back to the dashboard
           * rather than a blank screen.
           */
          <Safely
            label="Hs8View"
            whenBroken={
              <div className="hs8-page missing">
                <h1>HS {route.hs8}</h1>

                <p>
                  This tariff-line page could not be shown. The rest of the
                  dashboard is unaffected.
                </p>

                <button type="button" className="linkish" onClick={goHome}>
                  Back to the front page
                </button>
              </div>
            }
          >
            <Hs8View
              hs8={route.hs8}
              catalogue={catalogue}
              dark={dark}
              onOpen={openCode}
              onOpenHs8={openHs8}
              onHome={goHome}
            />
          </Safely>
        ) : onProduct && node && year !== null ? (
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
                label: nameOf(node),
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
          onOpenHs8={openHs8}
        />
        ) : (
          <HomeView
            onOpenHs8={openHs8}
            catalogue={catalogue}
            manifest={manifest}
            index={index}
            recent={recent}
            inBasket={inBasket}
            onOpen={openCode}
            onAdd={item => addToBasket({ code: item.code, level: item.level })}
            commands={commands}
            onLines={() => goTo({ kind: 'lines' })}
          />
        )}
      </main>

      {onProduct && node && year !== null && (
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
          onOpen={openRef}
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
      )}

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
