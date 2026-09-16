import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import type { SearchIndex, SearchOutcome } from '../lib/search'
import { search, suggestedTerms } from '../lib/search'
import type { SearchItem } from '../types'
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
function useTariffMatches(query: string): DgcisIndexEntry[] {
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

  return useMemo(() => {
    const text = query.trim().toLowerCase()

    if (!lines || text.length < 3) return []

    const digits = text.replace(/\D/g, '')

    const matched = lines.filter(line => {
      if (digits.length >= 4 && line.hs8.startsWith(digits)) return true

      if (digits.length >= 4) return false

      return (
        line.principalCommodity.toLowerCase().includes(text) ||
        line.quickEstimateCommodity.toLowerCase().includes(text)
      )
    })

    /* Biggest first. A reader who types "telecom" wants the line that carries
     * the trade, not the first one in numeric order. */
    return matched
      .sort(
        (a, b) =>
          (b.flows.exports?.last12UsdMillion ?? b.flows.imports?.last12UsdMillion ?? 0) -
          (a.flows.exports?.last12UsdMillion ?? a.flows.imports?.last12UsdMillion ?? 0),
      )
      .slice(0, 6)
  }, [lines, query])
}

function TariffResults({
  matches,
  query,
  onOpenHs8,
}: {
  matches: DgcisIndexEntry[]
  query: string
  onOpenHs8: (hs8: string) => void
}) {
  if (!matches.length) return null

  const exact = isHs8(query.trim()) ? query.trim() : null

  return (
    <div className="search-more tariff-more">
      <div className="search-more-head">
        India tariff lines · DGCIS
        <small>India reporting India — not world trade</small>
      </div>

      <div className="search-results-large">
        {matches.map(line => {
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
                  {line.principalCommodity || 'Indian tariff line'}
                </span>

                <span className="result-reason">
                  {twelve === null
                    ? `under HS ${line.hs6}`
                    : `${formatValue(twelve)} USD mn of ${flow}, 12 months · under HS ${line.hs6}`}
                </span>
              </button>
            </div>
          )
        })}
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
}: {
  index: SearchIndex
  onOpen: (item: SearchItem) => void
  /* Absent on a surface with nowhere to send a tariff line; the group then
   * does not appear at all, rather than offering a dead button. */
  onOpenHs8?: (hs8: string) => void
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

  const tariffMatches = useTariffMatches(onOpenHs8 ? query : '')

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
            if (event.key !== 'Enter') return

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
              ? 'Search a product or HS code…'
              : 'Search a product or an HS code — laptop, smartphone, 854231, solar panel…'
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

      {query.trim() && (
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
              matches={tariffMatches}
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
