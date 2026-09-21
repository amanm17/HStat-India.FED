import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'

/*
 * What the "i" in the corner is allowed to know.
 *
 * The first version of the help card was written entirely in App, from the
 * route alone. That is all a router can see, so every card said true but
 * generic things - "world trade in this product line, from UN Comtrade" -
 * which is the sentence a reader has already worked out from the page.
 *
 * The useful answer is about the thing in front of them: this code, these
 * figures, these panels. Only the page itself holds that. So the page
 * publishes it and the card reads it, and App keeps only the prose that is
 * genuinely route-level.
 *
 * Published on mount, cleared on unmount, so a card never describes the page
 * you just left.
 */
export type HelpFact = {
  label: string
  value: string
  /* Where the number came from, or what it excludes. One short clause. */
  note?: string
}

export type HelpPanel = {
  name: string
  what: string
}

export type PageHelp = {
  title?: string
  lines?: string[]
  /* The identifier on screen, decoded: what the code is and what it covers. */
  code?: { value: string; what: string; note?: string }
  /* Figures currently rendered, so the card explains what is actually there. */
  facts?: HelpFact[]
  /* The blocks on this page, each with the question it answers. */
  presented?: HelpPanel[]
  watch?: string
}

const Publish = createContext<(help: PageHelp | null) => void>(() => {})

export function PageHelpProvider({
  publish,
  children,
}: {
  publish: (help: PageHelp | null) => void
  children: ReactNode
}) {
  return <Publish.Provider value={publish}>{children}</Publish.Provider>
}

/*
 * `build` is called on every render but only its result is published, and
 * only when `deps` change - so a page can compose the card from state that
 * moves (the flow switch, the selected year) without publishing on every
 * keystroke elsewhere.
 */
export function usePageHelp(build: () => PageHelp, deps: unknown[]) {
  const publish = useContext(Publish)
  const latest = useRef(build)

  latest.current = build

  useEffect(() => {
    publish(latest.current())

    return () => publish(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
