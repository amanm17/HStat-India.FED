import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Moon, Sun } from 'lucide-react'

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

import { SearchHub } from './components/SearchHub'
import { ProductView } from './components/ProductView'
import { HStackPanel } from './components/HStackPanel'

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

    ;(async () => {
      const loaded = await loadManifest()

      setManifest(loaded.manifest)
      setSnapshot(loaded.snapshot)

      const [entries, terms, method] = await Promise.all([
        loadCatalogue(loaded.snapshot),
        loadSearch(),
        loadMethodology(loaded.snapshot),
      ])

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
          node={node}
          year={year}
          onYearChange={setYear}
          methodology={methodology}
          dark={dark}
          showHs8={showHs8}
          currency={currency}
          currencyBlock={manifest.currency}
          inBasket={inBasket(node.code)}
          onOpen={openCode}
          onAddToStack={() =>
            addToBasket({ code: node.code, level: node.level })
          }
        />
      </main>

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
