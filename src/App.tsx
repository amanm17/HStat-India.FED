import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid, Moon, Sigma, Sun } from 'lucide-react'

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
  comtradeEntries,
  type BasketEntry,
} from './lib/hstack'

import { useFallbackRates } from './lib/currency'
import { loadDgcisIndex } from './lib/dgcis'
import { nameOf } from './lib/format'
import { SearchHub, type Command } from './components/SearchHub'
import { ProductPage } from './components/ProductPage'
import { ViewAll, VIEW_ALL_SLUGS, type ViewAllTarget } from './components/ViewAll'
import { Hs8View } from './components/Hs8View'
import { TariffLines } from './components/TariffLines'
import { Guide } from './components/Guide'
import { NavRail } from './components/NavRail'
import { Availability } from './components/Availability'
import { QueryBuilder } from './components/QueryBuilder'
import { HelpButton, type HelpTopic } from './components/HelpButton'
import { PageHelpProvider, type PageHelp } from './lib/pagehelp'
import { TabBar, type TabId } from './components/TabBar'
import { Sheet } from './components/Sheet'
import { useNoRail } from './lib/viewport'
import { focusSearchBox, useSlashToSearch } from './lib/hotkeys'
import { Safely } from './components/Safely'
import { HomePage, type HomeRankKind } from './components/HomePage'
import type { RankKind } from './lib/scope'
import { HStackPanel } from './components/HStackPanel'
import { Sidebar, type ReportRequest } from './components/Sidebar'

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
  moveTile,
  resetLayout,
  type CodeRef,
  type SavedReport,
  type Workspace,
} from './lib/workspace'

import { saveReport as saveReportFile } from './lib/report'
import { useLook } from './lib/look'
import { LookSwitch } from './components/LookSwitch'
import { AmanMark } from './components/AmanMark'
import { productDocument, type ReportEntry } from './lib/reportdata'
import { loadDetail, usePageFiles } from './lib/scope'
import { loadDgcis } from './lib/dgcis'

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
  | { kind: 'availability' }
  | { kind: 'query' }
  /* A ranking in full: the "view all" step of the + pattern. */
  | { kind: 'viewall'; target: ViewAllTarget }

const SLUG_KINDS: Record<string, RankKind> = Object.fromEntries(
  Object.entries(VIEW_ALL_SLUGS).map(([kind, slug]) => [slug, kind as RankKind]),
)

function yearParam(): number | null {
  const value = Number(new URLSearchParams(window.location.search).get('year'))

  return Number.isInteger(value) && value > 1900 ? value : null
}

function levelOf(code: string): 2 | 4 | 6 {
  return code.length === 2 ? 2 : code.length === 4 ? 4 : 6
}

function routeFromPath(path: string): Route {
  if (/^\/tariff-lines\/?$/.test(path)) return { kind: 'lines' }
  if (/^\/guide\/?$/.test(path)) return { kind: 'guide' }
  if (/^\/availability\/?$/.test(path)) return { kind: 'availability' }
  if (/^\/query\/?$/.test(path)) return { kind: 'query' }

  const top = /^\/top\/(importers|exporters|finished|components)\/?$/.exec(path)

  if (top) {
    return {
      kind: 'viewall',
      target: { scope: 'home', kind: top[1] as HomeRankKind, year: yearParam() },
    }
  }

  const ranking = /^\/hs\/(\d{2}|\d{4}|\d{6})\/(importers|exporters|import-partners|export-partners)\/?$/.exec(path)

  if (ranking) {
    return {
      kind: 'viewall',
      target: { scope: 'product', code: ranking[1], kind: SLUG_KINDS[ranking[2]], year: yearParam() },
    }
  }

  const match = /^\/hs\/(\d{2}|\d{4}|\d{6}|\d{8})\/?$/.exec(path)

  if (!match) return { kind: 'home' }

  return match[1].length === 8
    ? { kind: 'tariff', hs8: match[1] }
    : { kind: 'product', code: match[1], level: levelOf(match[1]) }
}

function pathFor(route: Route): string {
  if (route.kind === 'lines') return '/tariff-lines'
  if (route.kind === 'guide') return '/guide'
  if (route.kind === 'availability') return '/availability'
  if (route.kind === 'query') return '/query'
  if (route.kind === 'tariff') return `/hs/${route.hs8}`

  if (route.kind === 'viewall') {
    const target = route.target
    const query = target.year ? `?year=${target.year}` : ''

    return target.scope === 'home'
      ? `/top/${target.kind}${query}`
      : `/hs/${target.code}/${VIEW_ALL_SLUGS[target.kind]}${query}`
  }

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
   * What the page currently on screen says about itself, for the help card.
   * Null between pages; see lib/pagehelp for why the page publishes this
   * rather than the router inventing it.
   */
  const [pageHelp, setPageHelp] = useState<PageHelp | null>(null)

  /*
   * Below 900px the rail hides itself and the bottom bar takes over. Below
   * 640 the page also stops trying to be a table. Both read matchMedia, so a
   * rotation is one event rather than a resize storm.
   */
  const noRail = useNoRail()

  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  /*
   * Two viewing modes, both in the topbar where the 1.x "IND" button used to
   * sit. HS-8 pulls India's tariff-line detail up through the page instead of
   * leaving it stranded at the bottom; the currency switch reads the same
   * figures in rupees. Neither changes any number - they change what is shown
   * and in which unit, and every block keeps saying which period it is on.
   */
  const [showHs8, setShowHs8] = useState(false)
  const [currency, setCurrency] = useState<CurrencyMode>('USD')

  /* The front page's year, kept here so returning to it keeps the choice. */
  const [homeYear, setHomeYear] = useState<number | null>(null)

  /*
   * The reader's own state: pins, history, which tiles they keep, and their
   * report library. Local to this browser and never sent anywhere.
   */
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    pinned: [],
    recent: [],
    hiddenTiles: [],
    order: DEFAULT_TILES,
    sidebarOpen: false,
    reports: [],
  }))

  const [reportBusy, setReportBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  /* The secret look (lib/look): presentation only. Read here so the whole
   * tree, charts included, re-renders when it changes. */
  const look = useLook()

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

      usePageFiles(loaded.manifest)

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

  /* The depth accent on page chrome follows the HS level being read. */
  useEffect(() => {
    const level =
      route.kind === 'tariff'
        ? '8'
        : route.kind === 'product' && node && node.code === route.code
          ? String(node.level)
          : route.kind === 'viewall' && route.target.scope === 'product'
            ? String(route.target.code.length)
            : 'home'

    document.documentElement.dataset.level = level
  }, [route, node])

  useEffect(() => {
    writeWorkspace(workspace)
  }, [workspace])

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

    if (!comtradeEntries(basket).length) {
      setBasketNodes([])
      return
    }

    let cancelled = false

    setBasketLoading(true)

    /* Eight-digit lines are DGCIS, not Comtrade: there is no snapshot node to
     * load for them, and the stack totals them separately. */
    loadHsNodes(snapshot, comtradeEntries(basket))
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

  const openViewAll = useCallback((target: ViewAllTarget) => {
    const next: Route = { kind: 'viewall', target }

    setRoute(next)
    setStackOpen(false)
    window.history.pushState({}, '', pathFor(next))
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
   * "/" from anywhere. On a phone that means the search sheet, because there
   * is no box in the title strip to focus; on a desktop it is whichever box
   * this page mounted. If neither exists - which should not happen, but a
   * page could be added without one - it falls back to the front page, which
   * always has one.
   *
   * Declared here rather than beside the other state because goHome is a
   * genuine dependency, and a dependency array is evaluated at render: naming
   * a const that is declared further down throws before the page ever paints.
   */
  useSlashToSearch(
    useCallback(() => {
      if (noRail) {
        setSearchOpen(true)
        return
      }

      if (!focusSearchBox()) goHome()
    }, [noRail, goHome]),
  )

  /*
   * What "/" can do.
   *
   * Deliberately only things a reader would otherwise have to hunt for: a
   * place to go, a mode to flip, a report to start. Nothing here is a new
   * capability - it is the same controls, reachable without knowing which
   * corner of the screen they live in.
   */
  /*
   * What this page is, in the reader's words rather than ours.
   *
   * Each one names the misreading that page invites. They are not decoration:
   * every "watch out" below is a mistake that has actually been made on this
   * data, by us, at least once.
   */
  const routeHelp = useMemo<HelpTopic>(() => {
    if (route.kind === 'guide') {
      return {
        title: 'The written guide',
        lines: [
          'Everything worth knowing about how to read this dashboard, in one page.',
          'The two data sources, why some years are blank, what each HS level is for, and how to get around.',
        ],
      }
    }

    if (route.kind === 'availability') {
      return {
        title: 'Reporter coverage',
        lines: [
          "UN Comtrade's own record of which economies have filed which period, joined to the 418 products tracked here.",
          'The banner at the top answers one question: would running a refresh bring in anything new.',
          'The gaps below say what each missing economy was worth, so you can judge how understated a year is.',
        ],
        watch:
          'a missing economy does not blank a figure, it understates it. The products listed under each gap are the ones affected.',
      }
    }

    if (route.kind === 'query') {
      return {
        title: 'Build a Comtrade query',
        lines: [
          'Pick a product by name and this writes the call three ways: Comtrade’s own results page, a keyless API URL, and Python for your own key.',
          'The fiddly part of pulling trade data is composing a correct query, not running it. This page does that part.',
        ],
        watch:
          'no key is asked for or stored here. HStat has no server to run a query on, so you run it where your key already lives.',
      }
    }

    if (route.kind === 'lines') {
      return {
        title: "India's tariff lines",
        lines: [
          'All 543 eight-digit lines India files under the headings we track, grouped by heading and sorted by size.',
          'Switch between exports and imports at the top right; filter by code or heading in the box.',
        ],
        watch:
          'these are India reporting India. There is no world figure at eight digits, and none of this is comparable with the Comtrade numbers on a product page.',
      }
    }

    if (route.kind === 'tariff') {
      return {
        title: 'One Indian tariff line',
        lines: [
          'India’s own monthly customs figures for a single eight-digit line, in both directions.',
          'The card partway down links up to the six-digit heading, where the world figures live.',
          'Named from India’s own eight-digit schedule where that schedule has a name for it, and by its code where it does not.',
        ],
        watch:
          'partner “World” here means India trading with everywhere. It does not mean world trade, and it must never be added to a Comtrade figure.',
      }
    }

    if (route.kind === 'product' && node) {
      return {
        title: `HS ${node.code} — ${nameOf(node)}`,
        lines: [
          'World trade in this product line, from UN Comtrade: every reporting economy’s imports from the world, net of re-imports.',
          'Below the world figures, India’s own eight-digit tariff lines for this heading, from DGCIS — a different source, a different period basis, shown separately on purpose.',
          'The right-hand rail chooses which panels show and builds a report from them.',
        ],
        watch:
          'a blank year is one whose reporter coverage was not good enough to publish. It means “we do not know”, never zero.',
      }
    }

    return {
      title: 'The front page',
      lines: [
        '418 electronics product lines, with world trade and India’s position in each.',
        'Search by product word or HS code, or type “/” for commands.',
        'India’s own tariff lines have their own panel, and their own page behind “All 543 lines”.',
      ],
      watch:
        'the headline total counts each product in its own most recent validated year, so it is an order of magnitude rather than a single-year figure.',
    }
  }, [route, node])

  /*
   * The route supplies the prose; the page supplies the specifics. Where both
   * have something, the page wins - it is looking at the data.
   */
  const helpTopic = useMemo<HelpTopic>(
    () => ({
      ...routeHelp,
      ...(pageHelp ?? {}),
      title: pageHelp?.title ?? routeHelp.title,
      lines: pageHelp?.lines ?? routeHelp.lines,
      watch: pageHelp?.watch ?? routeHelp.watch,
    }),
    [routeHelp, pageHelp],
  )

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'home', label: 'Front page', hint: 'the product catalogue and the search box',
        terms: ['start', 'index'], run: goHome },
      { id: 'lines', label: 'All tariff lines', hint: "India's 543 eight-digit lines, largest first",
        terms: ['hs8', 'tariff', 'eight'], run: () => goTo({ kind: 'lines' }) },
      { id: 'guide', label: 'How to read this dashboard', hint: 'what each source means, and what not to add together',
        terms: ['help', 'explain', 'how'], run: () => goTo({ kind: 'guide' }) },
      { id: 'availability', label: 'Reporter coverage', hint: 'which economies have filed, and which products are thin',
        terms: ['coverage', 'gaps', 'missing', 'fresh'], run: () => goTo({ kind: 'availability' }) },
      { id: 'query', label: 'Build a Comtrade query', hint: 'pick a product by name, get the call three ways',
        terms: ['api', 'pull', 'download', 'comtrade'], run: () => goTo({ kind: 'query' }) },
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

  /*
   * Quick stacking: several codes in one gesture.
   *
   * The reviewer's ask was "if I want to see all the HS-8 codes India has for
   * a given HS-6, put them together", and doing that one Add at a time is
   * eleven taps on some headings. Adds are idempotent and capped by the same
   * limit the basket already has, so a second tap on the same button is a
   * no-op rather than a duplicate.
   */
  const addManyToBasket = useCallback((incoming: BasketEntry[]) => {
    setBasket(current => {
      const have = new Set(current.map(entry => entry.code))

      const fresh = incoming.filter(entry => !have.has(entry.code))

      if (!fresh.length) return current

      return [...current, ...fresh].slice(0, 40)
    })

    setStackOpen(true)
  }, [])

  const removeFromBasket = useCallback((code: string) => {
    setBasket(current => current.filter(entry => entry.code !== code))
  }, [])

  const hiddenTiles = workspace.hiddenTiles

  /* Codes the report builder offers besides the one on screen: the reader's
   * pins and their HStack. Tariff lines are left out - a report is built
   * from Comtrade nodes. */
  const reportCandidates = useMemo<CodeRef[]>(() => {
    const byCode = new Map(catalogue.map(entry => [entry.code, entry]))
    const out: CodeRef[] = []

    for (const entry of workspace.pinned) {
      if (entry.level !== 8) out.push(entry)
    }

    for (const entry of comtradeEntries(basket)) {
      const found = byCode.get(entry.code)

      out.push({
        code: entry.code,
        level: entry.level,
        label: found ? nameOf(found) : entry.code,
      })
    }

    return out
  }, [workspace.pinned, basket, catalogue])

  /*
   * Rendering a report.
   *
   * Since the Phase 3 refresh a report is laid out from the data rather than
   * captured from the screen: every code and year asked for is loaded, and
   * the document is drawn with real text, so it does not depend on what the
   * reader happens to have open or folded away.
   */
  const runReport = useCallback(
    async (request: ReportRequest, remember: boolean) => {
      if (!manifest || !request.codes.length || !request.years.length) return

      setReportBusy(true)

      try {
        const nodes = await loadHsNodes(snapshot, request.codes)

        const entries: ReportEntry[] = await Promise.all(
          nodes.map(async item => {
            const [detail, dgcis, children] = await Promise.all([
              loadDetail(snapshot, item.code).catch(() => null),
              request.sections.includes('dgcis') && item.level === 6
                ? loadDgcis(item.code).catch(() => null)
                : Promise.resolve(null),
              request.sections.includes('inside')
                ? (() => {
                    const refs: { code: string; level: 2 | 4 | 6 }[] =
                      item.level === 4
                        ? (item.members ?? []).map(code => ({ code, level: 6 as const }))
                        : item.level === 2
                          ? catalogue
                              .filter(entry => entry.level === 4 && entry.code.startsWith(item.code))
                              .map(entry => ({ code: entry.code, level: 4 as const }))
                          : []

                    return refs.length && refs.length <= 60
                      ? loadHsNodes(snapshot, refs).catch(() => [] as HsNode[])
                      : Promise.resolve([] as HsNode[])
                  })()
                : Promise.resolve([] as HsNode[]),
            ])

            return { node: item, detail, dgcis, children }
          }),
        )

        const first = nodes[0]
        const subject =
          nodes.length > 1
            ? `${nodes.length} codes`
            : `${nameOf(first)} · HS-${first.level} ${first.code}`

        const title = request.name.trim() || `HStat.India — ${subject}`

        const doc = productDocument(entries, request.years, request.sections, manifest, title)

        const slug =
          nodes.length > 1 ? `hstat-${nodes.length}-codes` : `hstat-hs${first.level}-${first.code}`

        await saveReportFile(doc, request.layout, request.format, slug)

        if (remember) {
          setWorkspace(current => {
            const { workspace: next } = saveReport(current, {
              name: title,
              scope: nodes.length > 1 ? 'hstack' : 'product',
              code: first.code,
              level: first.level,
              subject,
              year: Math.max(...request.years),
              currency,
              tiles: request.sections,
              codes: request.codes,
              years: request.years,
              layout: request.layout,
            })

            return next
          })

          setFlash('Report downloaded and saved to your library.')
        } else {
          setFlash('Report downloaded.')
        }
      } catch (reason) {
        console.error(reason)
        setFlash('The report could not be rendered.')
      } finally {
        setReportBusy(false)
      }
    },
    [manifest, snapshot, catalogue, currency],
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
  const onAvailability = route.kind === 'availability'
  const onQuery = route.kind === 'query'
  const onViewAllPage = route.kind === 'viewall'
  const standalone = onLines || onGuide || onAvailability || onQuery || onViewAllPage
  const onProduct =
    !onTariff && !standalone && route.kind === 'product' && !!node && year !== null
  const showHome = !onTariff && !standalone && !onProduct

  /*
   * Nothing is lit on a product or a tariff line: those are reached from a
   * tab but are not one, and a bar that claims otherwise teaches the wrong
   * map. Search and More light only while their own sheet is open.
   */
  const activeTab: TabId | null = searchOpen
    ? 'search'
    : moreOpen
      ? 'more'
      : showHome
        ? 'home'
        : onLines
          ? 'lines'
          : onAvailability
            ? 'data'
            : null

  return (
    <PageHelpProvider publish={setPageHelp}>
    <div className="app">
      <header className="topbar">
        <div className="identity">
          {look === 'aman' ? (
            <AmanMark />
          ) : (
            <>
              <span className="fed-link" title="Foundation for Economic Development">
                <img className="fed-logo color" src="/brand/fed-logo.png" alt="Foundation for Economic Development" />
                <img className="fed-logo reversed" src="/brand/fed-logo-reversed.png" alt="" aria-hidden="true" />
              </span>

              <span className="identity-divider" aria-hidden="true" />
            </>
          )}

          <div className="identity-text">
            <button
              type="button"
              className="brand"
              onClick={goHome}
              aria-label="HStat.India home"
              title="Back to the front page"
            >
              HStat.<strong>India</strong>
              {look === 'aman' && <em className="brand-by"> by Aman</em>}
            </button>

            <div className="refresh">
              Updated {new Date(manifest.refreshedAt).toLocaleDateString('en-GB')}
              {snapshot === 'previous' && ' · last validated snapshot'}
            </div>
          </div>
        </div>

        {/*
          * The front page has its own search in the middle of the screen, and
          * a second one in the header three centimetres above it asked the
          * reader which of two identical boxes to use. On a product page the
          * header bar is the only way to move to another code, so it stays.
          */}
        {/*
          * Two search boxes on a phone is one too many: the bar version is
          * 190px wide up here, and Search is a whole tab down there with the
          * screen to itself. Below 900 the header keeps the brand and the
          * controls that act on this page, and nothing else.
          */}
        {!showHome && !noRail && (
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
          {/* The rail's handle, in the bar rather than floating over the page. */}
          {noRail && onProduct && !workspace.sidebarOpen && (
            <button
              className="stack-toggle"
              onClick={() =>
                setWorkspace(current => ({ ...current, sidebarOpen: true }))
              }
              aria-label="Open the workspace: tiles, pins and reports"
              title="Workspace"
            >
              <LayoutGrid size={16} />
            </button>
          )}

          <button
            className={basket.length ? 'stack-toggle active' : 'stack-toggle'}
            onClick={() => setStackOpen(true)}
            title="Open HStack"
          >
            <Sigma size={16} />
            HStack
            {basket.length > 0 && (
              <span className="stack-count">{basket.length}</span>
            )}
          </button>

          {!noRail && (
            <Safely label="HelpButton">
              <HelpButton topic={helpTopic} onGuide={() => goTo({ kind: 'guide' })} />
            </Safely>
          )}

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
        onGuide={() => goTo({ kind: 'guide' })}
        onTariffLines={() => goTo({ kind: 'lines' })}
        onAvailability={() => goTo({ kind: 'availability' })}
        onQuery={() => goTo({ kind: 'query' })}
        active={route.kind === 'product' ? route.code : route.kind === 'tariff' ? route.hs8 : null}
      />

      <main>
        {onAvailability ? (
          <Safely label="Availability">
            <Availability onOpen={openCode} onHome={goHome} />
          </Safely>
        ) : onQuery ? (
          <Safely label="QueryBuilder">
            <QueryBuilder catalogue={catalogue} onHome={goHome} />
          </Safely>
        ) : onLines ? (
          <Safely label="TariffLines">
            <TariffLines onOpenHs8={openHs8} onOpen={openCode} />
          </Safely>
        ) : onGuide ? (
          <Safely label="Guide">
            <Guide
              products={catalogue.filter(entry => entry.level === 6).length}
              onHome={goHome}
              onOpen={openCode}
              onLines={() => goTo({ kind: 'lines' })}
              onAvailability={() => goTo({ kind: 'availability' })}
              onQuery={() => goTo({ kind: 'query' })}
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
              onQuickStack={addManyToBasket}
              inBasket={inBasket}
              manifest={manifest}
            />
          </Safely>
        ) : onViewAllPage && route.kind === 'viewall' ? (
          <Safely label="ViewAll">
            <ViewAll
              target={route.target}
              snapshot={snapshot}
              catalogue={catalogue}
              currency={currency}
              currencyBlock={manifest.currency}
              onOpen={openCode}
              onBack={() => window.history.back()}
            />
          </Safely>
        ) : onProduct && node && year !== null ? (
          <ProductPage
            node={node}
            year={year}
            onYearChange={setYear}
            methodology={methodology}
            manifest={manifest}
            dark={dark}
            currency={currency}
            onCurrency={setCurrency}
            currencyBlock={manifest.currency}
            snapshot={snapshot}
            catalogue={catalogue}
            workspace={workspace}
            hiddenTiles={hiddenTiles}
            inBasket={inBasket(node.code)}
            pinned={workspace.pinned.some(entry => entry.code === node.code)}
            onTogglePin={() =>
              setWorkspace(current =>
                togglePin(current, { code: node.code, level: node.level, label: nameOf(node) }),
              )
            }
            onAddToStack={() => addToBasket({ code: node.code, level: node.level })}
            onQuickStack={addManyToBasket}
            onOpen={openCode}
            onOpenHs8={openHs8}
            onHome={goHome}
            onViewAll={(kind, forYear) =>
              openViewAll({ scope: 'product', code: node.code, kind, year: forYear })
            }
          />
        ) : (
          <HomePage
            onOpenHs8={openHs8}
            catalogue={catalogue}
            manifest={manifest}
            snapshot={snapshot}
            index={index}
            recent={recent}
            inBasket={inBasket}
            onOpen={openCode}
            onAdd={item => addToBasket({ code: item.code, level: item.level })}
            commands={commands}
            onLines={() => goTo({ kind: 'lines' })}
            reports={workspace.reports}
            onOpenReport={report => {
              if (report.code) openRef(report.code, (report.level ?? 6) as 2 | 4 | 6 | 8)
            }}
            onViewAll={(kind, forYear) => openViewAll({ scope: 'home', kind, year: forYear })}
            onStack={addManyToBasket}
            currency={currency}
            onCurrency={setCurrency}
            dark={dark}
            year={homeYear}
            onYear={setHomeYear}
          />
        )}
      </main>

      {onProduct && node && year !== null && (
        <Sidebar
          workspace={workspace}
          current={{ code: node.code, level: node.level, label: nameOf(node) }}
          candidates={reportCandidates}
          years={Object.entries(node.annual)
            .filter(([, record]) => record.global.trade !== null || record.india.imports !== null || record.india.exports !== null)
            .map(([key]) => Number(key))
            .sort((a, b) => b - a)}
          year={year}
          busy={reportBusy}
          onToggle={() =>
            setWorkspace(current => ({
              ...current,
              sidebarOpen: !current.sidebarOpen,
            }))
          }
          onOpen={openRef}
          onUnpin={id => setWorkspace(current => toggleTile(current, id))}
          onMove={(id, before) => setWorkspace(current => moveTile(current, id, before))}
          onResetLayout={() => {
            setWorkspace(current => resetLayout(current))
            setFlash('Sections are back to how they ship.')
          }}
          onTogglePin={entry => setWorkspace(current => togglePin(current, entry))}
          onGenerate={request => {
            void runReport(request, true)
          }}
          onRunReport={async (report: SavedReport, action) => {
            const codes = report.codes ?? (report.code ? [{ code: report.code, level: (report.level ?? 6) as 2 | 4 | 6 }] : [])
            const years = report.years ?? [report.year]

            if (action === 'view') {
              /* "View again" puts the page back on the report's first code
               * and latest year, so the reader sees today's figures. */
              if (codes[0] && codes[0].code !== node.code) {
                await openCode(codes[0].code, codes[0].level)
              }

              setYear(Math.max(...years))
              setFlash(`Showing ${report.name}.`)
              return
            }

            setWorkspace(current => touchReport(current, report.id))

            await runReport(
              {
                name: report.name,
                codes,
                years,
                sections: report.tiles,
                layout: report.layout ?? 'report',
                format: action,
              },
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

      <Safely label="LookSwitch">
        <LookSwitch
          onStart={() => {
            setSearchOpen(false)
            setMoreOpen(false)
            setHelpOpen(false)
          }}
        />
      </Safely>

      {noRail && (
        <Safely label="HelpButton">
          <HelpButton
            topic={helpTopic}
            onGuide={() => goTo({ kind: 'guide' })}
            floating={false}
            open={helpOpen}
            onOpenChange={setHelpOpen}
          />
        </Safely>
      )}

      {/*
        * The bottom bar exists only where the rail does not. It is rendered
        * rather than hidden with CSS so that its sheets, its focus trap and
        * its scroll lock do not exist at all on a desktop, where they would
        * be dead weight listening to keys.
        */}
      {noRail && (
        <Safely label="TabBar">
          <TabBar
            active={activeTab}
            moreOpen={moreOpen}
            onCloseMore={() => setMoreOpen(false)}
            onTab={tab => {
              if (tab === 'home') return goHome()
              if (tab === 'search') return setSearchOpen(true)
              if (tab === 'lines') return goTo({ kind: 'lines' })
              if (tab === 'data') return goTo({ kind: 'availability' })

              setMoreOpen(true)
            }}
            pinned={workspace.pinned}
            recent={workspace.recent}
            onOpen={ref => openRef(ref.code, ref.level)}
            onHelp={() => {
              setMoreOpen(false)
              setHelpOpen(true)
            }}
            onGuide={() => goTo({ kind: 'guide' })}
            onQuery={() => goTo({ kind: 'query' })}
            onAvailability={() => goTo({ kind: 'availability' })}
          />
        </Safely>
      )}

      {/*
        * Search gets the whole screen on a phone. In the header it was 78px
        * wide and truncated its own placeholder, which is not a search box,
        * it is a rumour of one.
        */}
      {noRail && (
        <Sheet
          open={searchOpen}
          title="Search"
          tall
          onClose={() => setSearchOpen(false)}
        >
          <SearchHub
            index={index}
            recent={recent}
            inBasket={inBasket}
            onOpen={item => {
              if (item.retired) return

              openCode(item.code, item.level)
              setSearchOpen(false)
            }}
            onAdd={item => addToBasket({ code: item.code, level: item.level })}
            onOpenHs8={hs8 => {
              openHs8(hs8)
              setSearchOpen(false)
            }}
            commands={commands.map(command => ({
              ...command,
              run: () => {
                command.run()
                setSearchOpen(false)
              },
            }))}
          />
        </Sheet>
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
    </PageHelpProvider>
  )
}

export default App
