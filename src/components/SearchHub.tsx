import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import type { SearchIndex, SearchOutcome } from '../lib/search'
import { search, suggestedTerms } from '../lib/search'
import type { SearchItem } from '../types'

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

export function SearchHub({
  index,
  onOpen,
  onAdd,
  inBasket,
  recent,
}: {
  index: SearchIndex
  onOpen: (item: SearchItem) => void
  onAdd: (item: SearchItem) => void
  inBasket: (code: string) => boolean
  recent: string[]
}) {
  const [query, setQuery] = useState('')

  const outcome = useMemo(() => search(index, query), [index, query])

  const suggestions = useMemo(() => suggestedTerms(index, 10), [index])

  const supporting = outcome.answer
    ? outcome.results.filter(
        result => result.item.code !== outcome.answer!.item.code,
      )
    : outcome.results

  return (
    <section className="search-hub">
      <div className="search-primary">
        <Search size={22} />

        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return

            const first = outcome.answer?.item ?? outcome.results[0]?.item

            if (first) {
              onOpen(first)
              setQuery('')
            }
          }}
          placeholder="Search a product or an HS code — laptop, smartphone, 854231, solar panel…"
          aria-label="Search products and HS codes"
        />

        {query && (
          <button className="search-clear" onClick={() => setQuery('')}>
            Clear
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="search-output">
          <AnswerCard
            outcome={outcome}
            index={index}
            onOpen={item => {
              onOpen(item)
              setQuery('')
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

          {!outcome.answer && supporting.length === 0 && (
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
    </section>
  )
}
