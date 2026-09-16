import { Component, type ErrorInfo, type ReactNode } from 'react'

/*
 * A boundary around anything that is an addition to the dashboard.
 *
 * React has one response to a throw during render: unmount the whole tree.
 * A bad number, a payload from a half-finished deploy, a null where an array
 * was expected - any of them, anywhere inside the DGCIS tariff-line work,
 * would take down the Comtrade dashboard that was working perfectly well
 * before eight-digit data existed. That trade is never worth making: the
 * tariff-line panel is detail, and the product page is the product.
 *
 * So the new material renders inside this. If it throws, it disappears, the
 * rest of the page carries on, and the error goes to the console where a
 * developer will find it. `whenBroken` is for the places where silence would
 * be confusing - a whole page, rather than a panel among many.
 */
export class Safely extends Component<
  { children: ReactNode; label: string; whenBroken?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] failed and was hidden`, error, info)
  }

  render() {
    if (this.state.failed) return this.props.whenBroken ?? null

    return this.props.children
  }
}
