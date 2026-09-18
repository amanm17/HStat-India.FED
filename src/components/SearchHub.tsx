import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import type { SearchIndex, SearchOutcome } from '../lib/search'
import { search, suggestedTerms } from '../lib/search'
import type { SearchItem } from '../types'

/*
 * A command the search box can run.
 *
 * Owned by App, not by this component: the search box should know how to find
 * a command and show it, and nothing about what pinning or theming means.
 */
export type Command = {
  id: string
  label: string
  hint: string
  /* Words that should also find it, beyond the label. */
  terms?: string[]
  run: () => void
}
import {
  formatValue,
  isHs8,
  loadDgcisIndex,
  type DgcisIndexEntry,
} from '../lib/dgcis'

/*
 * The old search returned a ranked list of HS codes for every query. That
 * is the right answer for "8471" and the wrong one for "laptop": someone
 * who types a product name is asking to be told where it sits, not to be
 * handed six codes and asked to pick.
 *
 * So a product query leads with one answer card, and the ranked list
 * becomes supporting evidence underneath it.
 */

function levelLabel(level: number) {
  return `HS-${level}`
}

function AnswerCard({
  outcome,
  index,
  onOpen,
  onAdd,
  inBasket,
}: {
  outcome: SearchOutcome
  index: SearchIndex
  onOpen: (item: SearchItem) => void
  onAdd: (item: SearchItem) => void
  inBasket: (code: string) => boolean
}) {
  const answer = outcome.answer

  if (!answer) return null

  const { item } = answer

  const isCode = outcome.kind === 'code'

  /*
   * HS 2022 is the base, so a retired code has no page of its own. The card
   * becomes a signpost: it says where the trade went and offers the
   * successors, rather than an Open button that leads nowhere.
   */
  const successors = (item.successors ?? [])
    .map(code => index.items.find(entry => entry.code === code))
    .filter((entry): entry is SearchItem => Boolean(entry))

  return (
    <div className="answer-card" data-confidence={answer.confidence}>
      <div className="answer-head">
        <span className="answer-eyebrow">
          {item.retired
            ? 'Retired code'
            : isCode
              ? 'What is in this code'
              : 'Where this sits'}
        </span>

        {item.retired && <span className="answer-hedge">Not in HS 2022</span>}

        {!item.retired && answer.confidence === 'strong' && (
          <span className="answer-hedge">Best match</span>
        )}
      </div>

      <h2 className="answer-headline">
        {isCode ? (
          <>
            {levelLabel(item.level)} {item.code} covers{' '}
            <strong>{item.label || item.product || item.description}</strong>
          </>
        ) : (
          <>
            <strong>{answer.term}</strong> is classified under{' '}
            <button
              className="answer-code"
              onClick={() => onOpen(item)}
              title="Open this product"
            >
              {levelLabel(item.level)} {item.code}
            </button>
          </>
        )}
      </h2>

      <p className="answer-description">{item.description}</p>

      {answer.note && <p className="answer-note">{answer.note}</p>}

      {item.keywords.length > 0 && (
        <div className="answer-keywords">
          <span>Also covers</span>

          {item.keywords.slice(0, 8).map(keyword => (
            <em key={keyword}>{keyword}</em>
          ))}
        </div>
      )}

      <div className="answer-actions">
        {item.retired ? (
          successors.length ? (
            successors.map(target => (
              <button
                key={target.code}
                className="answer-open"
                onClick={() => onOpen(target)}
              >
                Open {target.code} · {target.label || target.product}
              </button>
            ))
          ) : (
            <span className="answer-flag">
              No current successor code — this line was dropped.
            </span>
          )
        ) : (
          <>
            <button className="answer-open" onClick={() => onOpen(item)}>
              Open {item.code}
            </button>

            <button
              className="answer-add"
              onClick={() => onAdd(item)}
              disabled={inBasket(item.code)}
            >
              <Plus size={14} />
              {inBasket(item.code) ? 'In HStack' : 'Add to HStack'}
            </button>

            {!item.inFedDefinition && (
              <span className="answer-flag">
                Outside the FED sector definition — shown for reference
              </span>
            )}
          </>
        )}
      </div>

      {outcome.alsoIn.length > 0 && (
        <div className="answer-alsoin">
          <span>“{answer.term}” also appears in</span>

          {outcome.alsoIn.map(other => (
            <button key={other.code} onClick={() => onOpen(other)}>
              {other.code}
              <em>{other.label || other.product || other.description.slice(0, 40)}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/*
 * Tariff lines in search.
 *
 * Deliberately a separate lookup from the product index rather than more
 * rows inside it. The product index is Comtrade's world catalogue; a tariff
 * line is India reporting India, exists only in India's schedule, and has no
 * world figure at all. Merging them would put two different measurements in
 * one ranked list and let a reader carry an Indian number away believing it
 * was a world one.
 *
 * So they get their own group, under their own heading, with the source said
 * out loud - and they never displace the product answer above them.
 */
type TariffHit = {
  line: DgcisIndexEntry
  /* Why this line is in the list, so the row can say so rather than appear
   * out of nowhere under a word that is nowhere in the DGCIS file. */
  via: 'code' | 'group' | 'product'
  parent?: SearchItem
}

function useTariffMatches(
  query: string,
  outcome: SearchOutcome,
): TariffHit[] {
  const [lines, setLines] = useState<DgcisIndexEntry[] | null>(null)

  useEffect(() => {
    let live = true

    /* Cached at the module level, so this is one request per session however
     * many search boxes ask for it. A failure leaves lines null and the
     * group simply never appears. */
    loadDgcisIndex().then(index => {
      if (live) setLines(index?.lines ?? [])
    })

    return () => {
      live = false
    }
  }, [])

  /*
   * The products this query found, in the order search ranked them.
   *
   * This is the whole trick. DGCIS ships eight commodity groups and no
   * tariff-line descriptions, so "smartphone" matches nothing in its file and
   * never will - and writing descriptions for 543 tariff lines would be
   * inventing them, which is not allowed. But HStat already knows that
   * smartphones are HS 851713: the name was authored against the official HS
   * text, the aliases were curated, and `search()` resolves them today.
   *
   * So a product word reaches a tariff line the only honest way there is:
   * through the heading it belongs to. Nothing is invented; a curated answer
   * this dashboard already trusts is followed one level down.
   */
  const products = useMemo(() => {
    const ordered: SearchItem[] = []

    if (outcome.answer) ordered.push(outcome.answer.item)

    for (const result of outcome.results) {
      if (!ordered.some(item => item.code === result.item.code)) {
        ordered.push(result.item)
      }
    }

    return ordered.filter(item => item.level === 6 && !item.retired).slice(0, 4)
  }, [outcome])

  return useMemo(() => {
    const text = query.trim().toLowerCase()

    if (!lines || text.length < 3) return []

    const digits = text.replace(/\D/g, '')
    const size = (line: DgcisIndexEntry) =>
      line.flows.exports?.last12UsdMillion ??
      line.flows.imports?.last12UsdMillion ??
      0

    /* A code is unambiguous: answer it and stop. */
    if (digits.length >= 4) {
      return lines
        .filter(line => line.hs8.startsWith(digits))
        .sort((a, b) => size(b) - size(a))
        .slice(0, 6)
        .map(line => ({ line, via: 'code' as const }))
    }

    const hits: TariffHit[] = []
    const taken = new Set<string>()

    const push = (line: DgcisIndexEntry, via: TariffHit['via'], parent?: SearchItem) => {
      if (taken.has(line.hs8)) return

      taken.add(line.hs8)
      hits.push({ line, via, parent })
    }

    /* The product route first: a reader who typed a product name wants that
     * product's tariff lines, not whatever else shares a commodity group. */
    for (const item of products) {
      lines
        .filter(line => line.hs6 === item.code)
        .sort((a, b) => size(b) - size(a))
        .forEach(line => push(line, 'product', item))
    }

    /* Then DGCIS's own words, for someone who typed one of its group names. */
    lines
      .filter(line =>
        line.principalCommodity.toLowerCase().includes(text) ||
        line.quickEstimateCommodity.toLowerCase().includes(text))
      .sort((a, b) => size(b) - size(a))
      .forEach(line => push(line, 'group'))

    return hits.slice(0, 6)
  }, [lines, query, products])
}

function TariffResults({
  hits,
  query,
  onOpenHs8,
}: {
  hits: TariffHit[]
  query: string
  onOpenHs8: (hs8: string) => void
}) {
  if (!hits.length) return null

  const exact = isHs8(query.trim()) ? query.trim() : null

  /* Said once, above the list, when the list is there because of the product
   * the reader named rather than anything written in the DGCIS file. */
  const viaProduct = hits.find(hit => hit.via === 'product')?.parent

  return (
    <div className="search-more tariff-more">
      <div className="search-more-head">
        India tariff lines · DGCIS
        <small>India reporting India — not world trade</small>
      </div>

      {viaProduct && (
        <p className="tariff-via">
          The Indian eight-digit lines that sit under{' '}
          <strong>HS {viaProduct.code}</strong> ·{' '}
          {viaProduct.label || viaProduct.product}. DGCIS files no product
          names of its own, so these are reached through the heading.
        </p>
      )}

      <div className="search-results-large">
        {hits.map(({ line, via, parent }) => {
          const flow = line.flows.exports ? 'exports' : 'imports'
          const twelve = line.flows[flow]?.last12UsdMillion ?? null

          return (
            <div
              className={
                line.hs8 === exact ? 'search-result exact' : 'search-result'
              }
              key={line.hs8}
            >
              <button
                className="search-result-open"
                onClick={() => onOpenHs8(line.hs8)}
              >
                <span className="result-level">HS-8</span>

                <strong>{line.hs8}</strong>

                <span className="result-product">
                  {line.title || (
                    <>
                      under <strong>HS {line.hs6}</strong>
                      {line.headingName ? ` · ${line.headingName}` : ''}
                    </>
                  )}
                </span>

                <span className="result-reason">
                  {twelve === null
                    ? `under HS ${line.hs6}`
                    : `${formatValue(twelve)} USD mn of ${flow}, 12 months · ${
                        via === 'product'
                          ? line.principalCommodity || `under HS ${line.hs6}`
                          : `under HS ${line.hs6}`
                      }`}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CommandList({
  commands,
  query,
  onRun,
}: {
  commands: Command[]
  query: string
  onRun: (command: Command) => void
}) {
  const text = query.replace(/^\//, '').trim().toLowerCase()

  const matched = text
    ? commands.filter(command =>
        command.id.includes(text) ||
        command.label.toLowerCase().includes(text) ||
        (command.terms ?? []).some(term => term.includes(text)))
    : commands

  return (
    <div className="search-output">
      <div className="search-more command-more">
        <div className="search-more-head">
          Commands
          <small>press Enter to run the first, Esc to go back to searching</small>
        </div>

        {matched.length === 0 ? (
          <div className="search-empty">
            No command matches “{query.trim()}”. Delete the slash to search
            products and codes instead.
          </div>
        ) : (
          <div className="search-results-large">
            {matched.map(command => (
              <div className="search-result" key={command.id}>
                <button className="search-result-open" onClick={() => onRun(command)}>
                  <span className="result-level command-slug">/{command.id}</span>

                  <strong>{command.label}</strong>

                  <span className="result-reason">{command.hint}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function SearchHub({
  index,
  onOpen,
  onAdd,
  inBasket,
  recent,
  variant = 'hub',
  onOpenHs8,
  commands = [],
}: {
  index: SearchIndex
  onOpen: (item: SearchItem) => void
  /* Absent on a surface with nowhere to send a tariff line; the group then
   * does not appear at all, rather than offering a dead button. */
  onOpenHs8?: (hs8: string) => void
  /* Typing "/" turns the box into a command palette. The list is App's. */
  commands?: Command[]
  onAdd: (item: SearchItem) => void
  inBasket: (code: string) => boolean
  recent: string[]
  /*
   * 'bar' lives in the title strip and keeps everything it knows - answer
   * card, related codes, suggestions, recent - in a panel that opens under
   * the input. The page below then belongs to the product, which is what a
   * reader is actually here to read.
   */
  variant?: 'hub' | 'bar'
}) {
  const [query, setQuery] = useState('')

  const [open, setOpen] = useState(false)

  const shell = useRef<HTMLDivElement>(null)

  const bar = variant === 'bar'

  useEffect(() => {
    if (!bar || !open) return

    function onPointer(event: MouseEvent) {
      if (!shell.current?.contains(event.target as Node)) setOpen(false)
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [bar, open])

  const outcome = useMemo(() => search(index, query), [index, query])

  const suggestions = useMemo(() => suggestedTerms(index, 10), [index])

  const tariffMatches = useTariffMatches(onOpenHs8 ? query : '', outcome)

  /*
   * One box, two jobs, and the slash is the switch.
   *
   * Searching and doing are different intents, and a box that guesses which
   * one you meant gets it wrong often enough to be annoying. A leading slash
   * is unambiguous - nothing in this catalogue starts with one - and it is the
   * gesture people already know from every other tool they use.
   */
  const commanding = commands.length > 0 && query.startsWith('/')

  const runCommand = (command: Command) => {
    command.run()
    setQuery('')
    setOpen(false)
  }

  const supporting = outcome.answer
    ? outcome.results.filter(
        result => result.item.code !== outcome.answer!.item.code,
      )
    : outcome.results

  /* In the bar, nothing is shown until the reader asks for it. */
  const showPanel = bar ? open : true

  return (
    <section
      className={bar ? 'search-hub bar' : 'search-hub'}
      ref={shell}
    >
      <div className="search-primary">
        <Search size={bar ? 16 : 22} />

        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && query.startsWith('/')) {
              setQuery('')
              return
            }

            if (event.key !== 'Enter') return

            if (commanding) {
              const text = query.replace(/^\//, '').trim().toLowerCase()
              const first = text
                ? commands.find(command =>
                    command.id.includes(text) ||
                    command.label.toLowerCase().includes(text) ||
                    (command.terms ?? []).some(term => term.includes(text)))
                : commands[0]

              if (first) runCommand(first)
              return
            }

            const first = outcome.answer?.item ?? outcome.results[0]?.item

            if (first) {
              onOpen(first)
              setQuery('')
              setOpen(false)
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            bar
              ? 'Search, or / for commands…'
              : 'Search a product or an HS code — laptop, smartphone, 854231 — or type / for commands'
          }
          aria-label="Search products and HS codes"
          aria-expanded={bar ? open : undefined}
        />

        {query && (
          <button className="search-clear" onClick={() => setQuery('')}>
            Clear
          </button>
        )}
      </div>

      <div className={bar ? 'search-drop' : 'search-body'} hidden={!showPanel}>

      {commanding && (
        <CommandList commands={commands} query={query} onRun={runCommand} />
      )}

      {!commanding && query.trim() && (
        <div className="search-output">
          <AnswerCard
            outcome={outcome}
            index={index}
            onOpen={item => {
              onOpen(item)
              setQuery('')
              setOpen(false)
            }}
            onAdd={onAdd}
            inBasket={inBasket}
          />

          {supporting.length > 0 && (
            <div className="search-more">
              <div className="search-more-head">
                {outcome.answer
                  ? 'Related codes'
                  : `${supporting.length} matching codes`}
              </div>

              <div className="search-results-large">
                {supporting.slice(0, 8).map(({ item, reason }) => (
                  <div className="search-result" key={item.code}>
                    <button
                      className="search-result-open"
                      onClick={() => {
                        onOpen(item)
                        setQuery('')
                        setOpen(false)
                      }}
                      disabled={item.retired}
                    >
                      <span className="result-level">
                        {levelLabel(item.level)}
                      </span>

                      <strong>{item.code}</strong>

                      <span className="result-product">
                        {item.label || item.product || item.description}
                      </span>

                      <span className="result-reason">
                        {item.retired ? 'Retired in HS 2022' : reason}
                      </span>
                    </button>

                    <button
                      className="search-result-add"
                      title="Add to HStack"
                      onClick={() => onAdd(item)}
                      disabled={item.retired || inBasket(item.code)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {onOpenHs8 && (
            <TariffResults
              hits={tariffMatches}
              query={query}
              onOpenHs8={hs8 => {
                onOpenHs8(hs8)
                setQuery('')
                setOpen(false)
              }}
            />
          )}

          {!outcome.answer && supporting.length === 0 && tariffMatches.length === 0 && (
            <div className="search-empty">
              Nothing matched “{query.trim()}”. Try a product name, a brand-free
              description, or an HS code.
            </div>
          )}
        </div>
      )}

      {!query.trim() && (
        <>
          {commands.length > 0 && (
            <div className="smart-suggestions command-hint">
              <span>Tip</span>
              <button onClick={() => setQuery('/')}>
                type <kbd>/</kbd> for commands
              </button>
            </div>
          )}

          <div className="smart-suggestions">
            <span>Try</span>

            {suggestions.map(term => (
              <button key={term} onClick={() => setQuery(term)}>
                {term}
              </button>
            ))}
          </div>

          {recent.length > 0 && (
            <div className="smart-suggestions recent">
              <span>Recent</span>

              {recent.map(term => (
                <button key={term} onClick={() => setQuery(term)}>
                  {term}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      </div>
    </section>
  )
}
