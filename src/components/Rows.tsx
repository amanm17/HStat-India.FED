import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/*
 * A table, on a screen too narrow to be one.
 *
 * THE PROBLEM WITH A TABLE AT 390px
 *
 * The tariff index has four columns. At 390px, after the page's own gutters,
 * each gets about 85px - enough for "85176290" and nothing else, so the name
 * column ellipses to "Switching and rout…" and the figure column wraps its
 * own thousands separator. Scrolling it sideways inside a page that scrolls
 * vertically is worse: on touch the two gestures compete, and the reader
 * loses the row they were on.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Each row becomes a card. Collapsed, it shows the identifier and the one or
 * two figures marked `lead` - the numbers somebody scanning is actually
 * scanning for. Tapping anywhere on the card reveals the rest as labelled
 * pairs, which is the only honest way to show a figure whose column header is
 * no longer on screen.
 *
 * The expand is the whole card, not a 16px chevron: the chevron says what
 * will happen, the card is what you hit. Where a row also has a destination -
 * a tariff line has its own page - that is a separate, clearly labelled
 * button, because "open this" and "tell me more here" must never be the same
 * gesture with different outcomes.
 *
 * Only rendered on phones. The table is still a table everywhere else, and
 * this component is not in that tree at all.
 */
export type RowField = {
  label: string
  value: ReactNode
  /* Shown while collapsed. Two at most - a third makes a card that is a bad
   * table rather than a good card. */
  lead?: boolean
  /* Numbers line up right and use tabular figures; words do not. */
  numeric?: boolean
}

export type RowItem = {
  id: string
  title: ReactNode
  subtitle?: ReactNode
  fields: RowField[]
  /* The row's own page, when it has one. */
  onOpen?: () => void
  openLabel?: string
}

export function Rows({
  items,
  label,
}: {
  items: RowItem[]
  /* Names the list for a screen reader, since the table's caption is gone. */
  label: string
}) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <ul className="rows" aria-label={label}>
      {items.map(item => {
        const lead = item.fields.filter(field => field.lead)
        const rest = item.fields.filter(field => !field.lead)
        const isOpen = open === item.id
        const expandable = rest.length > 0

        return (
          <li className={isOpen ? 'row open' : 'row'} key={item.id}>
            <button
              className="row-head"
              onClick={() => expandable && setOpen(isOpen ? null : item.id)}
              aria-expanded={expandable ? isOpen : undefined}
              /* A card with nothing hidden is not a button. */
              disabled={!expandable}
            >
              <span className="row-main">
                <span className="row-title">{item.title}</span>
                {item.subtitle && <span className="row-sub">{item.subtitle}</span>}
              </span>

              <span className="row-lead">
                {lead.map(field => (
                  <span
                    className={field.numeric ? 'row-figure num' : 'row-figure'}
                    key={field.label}
                  >
                    <b>{field.value}</b>
                    <i>{field.label}</i>
                  </span>
                ))}
              </span>

              {expandable && (
                <ChevronDown className="row-chev" size={17} aria-hidden="true" />
              )}
            </button>

            {isOpen && (
              <div className="row-detail">
                <dl>
                  {rest.map(field => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd className={field.numeric ? 'num' : undefined}>
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {item.onOpen && (
                  <button className="row-open" onClick={item.onOpen}>
                    {item.openLabel ?? 'Open'}
                  </button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
