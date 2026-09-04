import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Combine,
  GripVertical,
  Split,
  Wand2,
} from 'lucide-react'

import {
  DEFAULT_SLIDES,
  TILES,
  isNarrowTile,
  slides,
  type Workspace,
} from '../lib/workspace'

/*
 * One set of tiles, two ways of reading them.
 *
 * Report View is the page as it has always been: everything stacked, scrolled
 * top to bottom, meant to be read through. Glance View is the same tiles as
 * slides you move across one at a time, for when you know what you are
 * looking for and want it filling the screen.
 *
 * The deck takes the tiles as children and arranges them itself, rather than
 * each view rendering its own copy. That is what keeps the two honest: there
 * is one implementation of every panel, one arrangement, and a report
 * captures whichever is on screen.
 *
 * Dragging reorders in both views and the new order is the one the report
 * builder uses, because a reader who has arranged the page has already said
 * what order they want.
 */

type TileChild = ReactElement<{ id: string }>

/* How far a short slide may be scaled up to fill its frame. Past about a
 * quarter it stops reading as a slide and starts reading as a mistake. */
const CEILING = 1.3

/* Gap between tiles sharing a slide, matching the stylesheet. */
const GAP = 18

/* Below this the slide is one column and pairing makes no sense. */
const WIDE = 1000

type Placed = { id: string; span: 1 | 2; edge: 'none' | 'row' | 'col' }

/*
 * How a slide's tiles sit in its two columns.
 *
 * A narrow tile next to another narrow tile takes half the slide; anything
 * else takes the width. `edge` says which rule the tile is separated by, so
 * a stacked tile gets a line above it and the right-hand half of a pair gets
 * one beside it.
 */
function arrange(group: string[], wide: boolean): Placed[] {
  const out: Placed[] = []

  let index = 0

  while (index < group.length) {
    const id = group[index]
    const next = group[index + 1]

    if (wide && isNarrowTile(id) && next && isNarrowTile(next)) {
      out.push({ id, span: 1, edge: out.length ? 'row' : 'none' })
      out.push({ id: next, span: 1, edge: 'col' })

      index += 2
    } else {
      out.push({ id, span: 2, edge: out.length ? 'row' : 'none' })

      index += 1
    }
  }

  return out
}

function labelFor(id: string): string {
  return TILES.find(tile => tile.id === id)?.label ?? id
}

function key(groups: string[][]): string {
  return groups.map(group => group.join('+')).join('|')
}

/*
 * Reconcile a plan with the tiles actually on the page.
 *
 * A plan is measured from what is rendered, and only what the plan lists is
 * rendered - so a tile the plan has never seen would never appear, never be
 * measured, and never be planned for. Opening an HS-4 code after an HS-6
 * one is exactly that case: "What's inside" and "Coverage" arrive with the
 * new code and were silently missing from the deck.
 *
 * So the plan is never trusted as the whole story: anything present and
 * unplanned is shown on its own slide, in its place in the order, until the
 * next pass has measured it and can pack it properly.
 */
function withAll(plan: string[][], present: string[]): string[][] {
  const done = new Set<string>()

  const out: string[][] = []

  for (const id of present) {
    if (done.has(id)) continue

    const group = plan
      .find(item => item.includes(id))
      ?.filter(member => present.includes(member))

    /*
     * A group is only honoured where its tiles are still next to each other
     * in the reader's order. Otherwise it would pull a tile out of sequence
     * to join it, and the deck would stop reading in the order the page is
     * arranged in - which is the one thing the packer may not do.
     */
    const contiguous =
      group &&
      group.length > 0 &&
      group.every(
        (member, offset) => present[present.indexOf(id) + offset] === member,
      )

    if (contiguous && group) {
      for (const member of group) done.add(member)

      out.push(group)
    } else {
      done.add(id)

      out.push([id])
    }
  }

  return out
}

/*
 * Work out how many tiles fit on a slide, by measuring them.
 *
 * A fixed grouping cannot be dense, because how tall a tile is depends on
 * the data behind it - the same "who sells" panel is a ranked table of ten
 * economies for one code and a single line saying the export side is not
 * published for another, and a rule written for the first gives the second
 * a whole screen to itself.
 *
 * So each tile is measured off-screen at the width it would actually get,
 * inside a stage that carries the card's own class (the panels lose their
 * frames and charts change height in there, and a measurement taken outside
 * that context would be of a different tile). Then it is a greedy pack in
 * reading order: keep adding while the slide still has room. Order is never
 * rearranged to improve the fit - the reader's sequence is the one thing the
 * packer may not touch.
 */
function packSlides(
  ids: string[],
  width: number,
  height: number,
  wide: boolean,
): string[][] | null {
  if (!ids.length || width <= 0 || height <= 0) return null

  const stage = document.createElement('div')

  stage.className = 'glance-card glance-stage'
  stage.setAttribute('aria-hidden', 'true')

  document.body.appendChild(stage)

  const full = new Map<string, number>()
  const half = new Map<string, number>()

  try {
    for (const id of ids) {
      const source = document.getElementById(`tile-${id}`)

      if (!source) continue

      const slot = document.createElement('div')

      slot.className = 'tile-slot'

      const clone = source.cloneNode(true) as HTMLElement

      clone.removeAttribute('id')

      slot.appendChild(clone)
      stage.appendChild(slot)

      stage.style.width = `${width}px`
      full.set(id, slot.offsetHeight)

      if (wide && isNarrowTile(id)) {
        stage.style.width = `${(width - 22) / 2}px`
        half.set(id, slot.offsetHeight)
      }

      stage.removeChild(slot)
    }
  } finally {
    document.body.removeChild(stage)
  }

  if (!full.size) return null

  /* The rows a slide could hold, in the reader's order: one tile across the
   * slide, or two narrow ones sharing it. */
  const rows: { tiles: string[]; height: number }[] = []

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]

    /* A tile that could not be measured still belongs in the deck. Giving
     * it a slide of its own is what puts it on the page, where the next
     * pass can measure it and pack it with its neighbours. */
    if (!full.has(id)) {
      rows.push({ tiles: [id], height })

      continue
    }

    const next = ids[index + 1]

    if (
      wide &&
      isNarrowTile(id) &&
      next &&
      isNarrowTile(next) &&
      half.has(id) &&
      half.has(next)
    ) {
      rows.push({
        tiles: [id, next],
        height: Math.max(half.get(id)!, half.get(next)!),
      })

      index += 1

      continue
    }

    rows.push({ tiles: [id], height: full.get(id)! })
  }

  if (!rows.length) return null

  const fill = (limit: number): string[][] => {
    const out: string[][] = []

    let group: string[] = []
    let used = 0

    for (const row of rows) {
      const cost = group.length ? row.height + GAP : row.height

      /* A row that will not fit starts the next slide - unless the slide is
       * empty, in which case the row is taller than any slide and gets one
       * of its own to scroll in. */
      if (group.length && used + cost > limit) {
        out.push(group)

        group = []
        used = row.height
      } else {
        used += cost
      }

      group.push(...row.tiles)
    }

    if (group.length) out.push(group)

    return out
  }

  const greedy = fill(height)

  /*
   * Greedy filling loads the front of the deck and leaves the remainder on
   * the last slide, which is how you end up reading five full screens and
   * then one with a two-line table adrift in the middle of it. Once the
   * number of slides is known, the same rows are packed again against the
   * average - so the deck is evenly full rather than full then empty. If
   * that needs an extra slide it is not an improvement, and the greedy
   * arrangement stands.
   */
  const tallest = rows.reduce((most, row) => Math.max(most, row.height), 0)

  const total =
    rows.reduce((sum, row) => sum + row.height, 0) + GAP * (rows.length - 1)

  const average = total / greedy.length

  const balanced = fill(
    Math.min(height, Math.max(average * 1.06, tallest + GAP)),
  )

  const out = balanced.length <= greedy.length ? balanced : greedy

  return out.length ? out : null
}

export function TileDeck({
  workspace,
  children,
  onReorder,
  onArrange,
  onAuto,
}: {
  workspace: Workspace
  children: ReactNode
  onReorder: (dragged: string, before: string | null) => void
  /* The whole arrangement, not one change to it: what the reader can see is
   * what gets stored, including the groups the packer chose for them. */
  onArrange: (groups: string[][]) => void
  onAuto: () => void
}) {
  /* Children arrive in source order and carry their own id; the arrangement
   * comes from the workspace, so the two never have to agree in the JSX. */
  const byId = useMemo(() => {
    const map = new Map<string, TileChild>()

    for (const child of Children.toArray(children)) {
      if (!isValidElement(child)) continue

      const id = (child.props as { id?: string })?.id

      if (id) map.set(id, child as TileChild)
    }

    return map
  }, [children])

  const present = useMemo(
    () => workspace.order.filter(id => byId.has(id)),
    [workspace.order, byId],
  )

  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const glance = workspace.view === 'glance'

  /*
   * What the packer worked out, once it has had a frame to measure in, and
   * the set of tiles it was measured against. A plan only ever applies to
   * the tiles it was made from: open a code with an extra tile and the old
   * plan is not "nearly right", it is a plan for a different page.
   */
  const [plan, setPlan] = useState<{ for: string; groups: string[][] } | null>(
    null,
  )

  const presentKey = present.join('|')

  /* fitCards runs from observers and timers, so it reads these rather than
   * whatever was in scope when it was created. */
  const presentRef = useRef(present)
  const planRef = useRef<{ for: string; groups: string[][] } | null>(null)

  presentRef.current = present
  planRef.current = plan

  const [wide, setWide] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= WIDE,
  )

  const deck = workspace.autoPack
    ? withAll(
        plan && plan.for === presentKey
          ? plan.groups
          : slides({ ...workspace, merged: DEFAULT_SLIDES }, present),
        present,
      )
    : slides(workspace, present)

  const [slide, setSlide] = useState(0)

  /* Removing or hiding a tile can leave the index past the end. */
  useEffect(() => {
    setSlide(current => Math.min(current, Math.max(deck.length - 1, 0)))
  }, [deck.length])

  const track = useRef<HTMLDivElement>(null)

  /* Set while the deck is scrolling itself, so its own smooth-scroll does
   * not read back as the reader having swiped somewhere. */
  const steering = useRef(0)

  /*
   * The indicator follows the track, not the click.
   *
   * The first version set the slide index and scrolled to match, which meant
   * a swipe, a trackpad flick or a snap landing anywhere else left the dots
   * pointing at a slide the reader was no longer on. Reading the scroll
   * position back is the only version that is true however the reader moved.
   */
  useEffect(() => {
    const node = track.current

    if (!glance || !node) return

    let frame = 0

    function onScroll() {
      if (frame) return

      frame = window.requestAnimationFrame(() => {
        frame = 0

        if (Date.now() < steering.current) return

        /* Slides are narrower than the track so the neighbours peek in at
         * the edges, which means the track width is the wrong divisor. */
        const width =
          (node!.firstElementChild as HTMLElement | null)?.offsetWidth ||
          node!.clientWidth ||
          1

        setSlide(current => {
          const next = Math.round(node!.scrollLeft / width)

          return next === current ? current : next
        })
      })
    }

    node.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      node.removeEventListener('scroll', onScroll)

      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [glance])

  /*
   * Fill the frame.
   *
   * A slide carrying one short panel - the identity block, a pair of notes -
   * left two thirds of the card empty, which is what made the deck look like
   * a page with the middle cut out rather than a deck. Every card is the
   * same size, so the only honest way to fill a short one is to let its
   * content take the room: measure what the tiles actually need and scale up
   * to the frame, never past a point where it would look blown up.
   *
   * `zoom` rather than a transform, because a transform would scale the box
   * out of the card and leave the scrolling and hit targets behind it.
   */
  const frame = useRef<HTMLDivElement>(null)

  const measuring = useRef(false)

  const fitCards = useCallback(() => {
    const node = track.current

    if (!node || measuring.current) return

    measuring.current = true

    /*
     * The deck is exactly the room left below the header. A fixed
     * "viewport minus 92px" was right at one window size and wrong at every
     * other - on a narrow window the header wraps to two rows and the nav
     * pill fell off the bottom of the screen.
     */
    const root = frame.current

    if (root) {
      const top = root.getBoundingClientRect().top

      root.style.height = `${Math.max(420, window.innerHeight - top - 14)}px`
    }

    const cards = Array.from(
      node.querySelectorAll<HTMLElement>('.glance-card'),
    )

    /* Measure unscaled and un-grown, or each pass compounds the last one. */
    for (const card of cards) {
      card.style.zoom = '1'

      for (const shell of Array.from(
        card.querySelectorAll<HTMLElement>('.chart-shell'),
      )) {
        shell.style.height = ''
      }
    }

    const first = cards[0]

    if (first) {
      const style = window.getComputedStyle(first)

      const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)

      const tiles = presentRef.current

      const packed = packSlides(
        tiles,
        first.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        first.clientHeight - padding,
        window.innerWidth >= WIDE,
      )

      setWide(window.innerWidth >= WIDE)

      const current = planRef.current

      /* Only when it actually changed, or this would re-render forever. */
      if (
        packed &&
        (current?.for !== tiles.join('|') ||
          key(packed) !== key(current.groups))
      ) {
        const next = { for: tiles.join('|'), groups: packed }

        planRef.current = next

        setPlan(next)
      }
    }

    for (const card of cards) {
      const fill = card.querySelector<HTMLElement>(':scope > .glance-fill')

      if (!fill) continue

      const style = window.getComputedStyle(card)

      const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)

      const frame = card.clientHeight - padding

      /*
       * A chart with the slide to itself is drawn to the slide. Scaling a
       * chart up by a quarter only makes its labels bigger; giving it the
       * room makes it a better chart. This happens after packing, and only
       * into space the slide already had spare, so it cannot make a slide
       * that was measured to fit stop fitting.
       */
      const shells = Array.from(
        card.querySelectorAll<HTMLElement>('.chart-shell'),
      )

      if (card.dataset.count === '1' && shells.length === 1) {
        const slack = frame - fill.offsetHeight

        if (slack > 60) {
          shells[0].style.height = `${shells[0].offsetHeight + slack - 10}px`
        }
      }

      const content = fill.offsetHeight

      if (content <= 0 || frame <= 0) continue

      let scale = Math.min(CEILING, (frame / content) * 0.98)

      /*
       * Scaling up narrows the room a line of text has, so some of it wraps
       * onto another line and the content the first measurement was taken
       * from is no longer the content on screen. Settle it: apply, look
       * again, and come back down if the slide now runs over.
       */
      for (let pass = 0; pass < 3 && scale > 1.03; pass += 1) {
        card.style.zoom = scale.toFixed(3)

        const room = card.clientHeight - padding

        const actual = fill.offsetHeight

        if (actual <= room) break

        scale = Math.max(1, scale * (room / actual))
      }

      card.style.zoom = scale > 1.03 ? scale.toFixed(3) : '1'
    }

    /* Released after the frame the writes land in, so the observer below
     * does not read a measurement as a change. */
    window.requestAnimationFrame(() => {
      measuring.current = false
    })
  }, [])

  const deckKey = deck.map(group => group.join('+')).join('|')

  useEffect(() => {
    if (!glance) return

    fitCards()

    /* Charts and tables settle a frame or two after a slide appears, and a
     * new product or year re-renders the panels underneath us. */
    const settle = window.setTimeout(fitCards, 400)

    const observer = new ResizeObserver(() => fitCards())

    const node = track.current

    if (node) {
      observer.observe(document.body)
      observer.observe(node)

      for (const slot of Array.from(
        node.querySelectorAll<HTMLElement>('.glance-card > .tile-slot'),
      )) {
        observer.observe(slot)
      }
    }

    window.addEventListener('resize', fitCards)

    return () => {
      window.clearTimeout(settle)
      window.removeEventListener('resize', fitCards)
      observer.disconnect()
    }
  }, [glance, fitCards, deckKey])

  function goTo(index: number) {
    const node = track.current

    const next = Math.max(0, Math.min(index, deck.length - 1))

    setSlide(next)

    if (!node) return

    steering.current = Date.now() + 700

    const width =
      (node.firstElementChild as HTMLElement | null)?.offsetWidth ||
      node.clientWidth

    node.scrollTo({ left: next * width, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!glance) return

    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement

      /* Arrow keys belong to whatever the reader is typing in or to a
       * select they have open, not to the deck. */
      if (
        target?.closest('input, select, textarea, [contenteditable="true"]')
      ) {
        return
      }

      if (event.key === 'ArrowRight') goTo(slide + 1)

      if (event.key === 'ArrowLeft') goTo(slide - 1)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [glance, deck.length])


  function dragProps(id: string) {
    return {
      onDragOver: (event: React.DragEvent) => {
        if (!dragging || dragging === id) return

        event.preventDefault()
        setOver(id)
      },
      onDragLeave: () => setOver(current => (current === id ? null : current)),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()

        if (dragging && dragging !== id) onReorder(dragging, id)

        setDragging(null)
        setOver(null)
      },
    }
  }

  function handle(id: string) {
    return (
      <button
        className="tile-grip"
        draggable
        aria-label={`Reorder ${labelFor(id)}`}
        title="Drag to reorder"
        onDragStart={event => {
          setDragging(id)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', id)
        }}
        onDragEnd={() => {
          setDragging(null)
          setOver(null)
        }}
      >
        <GripVertical size={14} />
      </button>
    )
  }

  if (!glance) {
    return (
      <div className="tiledeck report-view">
        {present.map(id => (
          <div
            key={id}
            className={
              (dragging === id ? 'tile-slot dragging' : 'tile-slot') +
              (over === id ? ' over' : '')
            }
            {...dragProps(id)}
          >
            {handle(id)}
            {byId.get(id)}
          </div>
        ))}

        {/* A last drop target, so a tile can be moved to the very end. */}
        <div
          className={over === '__end' ? 'tile-end over' : 'tile-end'}
          onDragOver={event => {
            if (!dragging) return
            event.preventDefault()
            setOver('__end')
          }}
          onDragLeave={() => setOver(null)}
          onDrop={event => {
            event.preventDefault()
            if (dragging) onReorder(dragging, null)
            setDragging(null)
            setOver(null)
          }}
        >
          {dragging ? 'Drop here to move to the end' : ''}
        </div>
      </div>
    )
  }

  const current = deck[slide] ?? []

  return (
    <div className="tiledeck glance-view" ref={frame}>
      {/*
        * The slide's own strip: where you are, what you are looking at, and
        * whether it shares the frame with anything. It sits above the card
        * because that is where a reader looks for it - the first version put
        * it underneath, detached from the panel it described.
        */}
      <div className="glance-bar">
        <span className="glance-pos">
          {slide + 1}
          <em>/ {deck.length}</em>
        </span>

        <h2>{current.map(labelFor).join('  +  ')}</h2>

        <div className="glance-bar-actions">
          {!workspace.autoPack && (
            <button
              onClick={onAuto}
              title="Let the deck fill each slide again"
            >
              <Wand2 size={13} />
              Auto-fill
            </button>
          )}

          {current.length > 1 ? (
            <button
              onClick={() =>
                onArrange(
                  deck.flatMap((group, index) =>
                    index === slide ? group.map(id => [id]) : [group],
                  ),
                )
              }
            >
              <Split size={13} />
              Split
            </button>
          ) : (
            slide < deck.length - 1 && (
              <button
                onClick={() =>
                  onArrange(
                    deck
                      .map((group, index) =>
                        index === slide
                          ? [...group, ...deck[slide + 1]]
                          : group,
                      )
                      .filter((_, index) => index !== slide + 1),
                  )
                }
              >
                <Combine size={13} />
                Merge with next
              </button>
            )
          )}
        </div>
      </div>

      <div className="glance-track" ref={track}>
        {deck.map((group, index) => (
          <section
            className="glance-slide"
            key={group.join('+')}
            aria-label={group.map(labelFor).join(' and ')}
            aria-hidden={index !== slide}
          >
            <div
              className={
                index === slide ? 'glance-card current' : 'glance-card'
              }
              data-count={group.length}
            >
              {/* The card is the frame; this is what fills it. Keeping them
                * separate is what lets the deck measure the content exactly
                * rather than guess at it. */}
              <div className="glance-fill">
                {arrange(group, wide).map(({ id, span, edge }) => (
                  <div
                    key={id}
                    data-span={span}
                    data-edge={edge}
                    className={
                      (dragging === id ? 'tile-slot dragging' : 'tile-slot') +
                      (over === id ? ' over' : '')
                    }
                    {...dragProps(id)}
                  >
                    {handle(id)}
                    {byId.get(id)}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="glance-nav">
        <button
          disabled={slide === 0}
          onClick={() => goTo(slide - 1)}
          aria-label="Previous slide"
        >
          <ChevronLeft size={18} />
        </button>

        {/*
          * Dots while they can still be told apart; a labelled list once they
          * cannot. Twelve identical dots is not an indicator, it is texture.
          */}
        {deck.length <= 10 ? (
          <div className="glance-dots" role="tablist">
            {deck.map((group, index) => (
              <button
                key={group.join('+')}
                role="tab"
                aria-selected={index === slide}
                aria-label={group.map(labelFor).join(' and ')}
                title={group.map(labelFor).join(' + ')}
                className={index === slide ? 'on' : ''}
                onClick={() => goTo(index)}
              />
            ))}
          </div>
        ) : (
          <div className="glance-count">
            <select
              value={slide}
              aria-label="Go to slide"
              onChange={event => goTo(Number(event.target.value))}
            >
              {deck.map((group, index) => (
                <option key={group.join('+')} value={index}>
                  {index + 1}. {group.map(labelFor).join(' + ')}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          disabled={slide >= deck.length - 1}
          onClick={() => goTo(slide + 1)}
          aria-label="Next slide"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
