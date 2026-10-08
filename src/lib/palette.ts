import { currentLook } from './look'

/*
 * Chart colours - the FED palette, one meaning per hue (execution prompt
 * §2.1), identical on every page so charts stay comparable across pages:
 *
 *   global   Indigo Dye    Global Trade
 *   exports  Ming          India Exports
 *   imports  English Red   India Imports
 *
 * Dark mode lightens the same three hues rather than choosing new ones, far
 * enough to clear 3:1 against the dark surface for marks and 4.5:1 for any
 * label drawn in them, and they stay distinguishable from each other: blue,
 * green and rose differ in hue as well as lightness. Every chart also carries
 * a legend or direct labels, so identity never rests on colour alone.
 *
 * `primary` is kept as an alias of `global` for single-series magnitude
 * charts, which are always world figures.
 */

export type Palette = {
  global: string
  imports: string
  exports: string
  primary: string
  grid: string
  axis: string
  surface: string
  text: string
  finished: string
  components: string
}

const LIGHT: Palette = {
  global: '#133E68',
  imports: '#9F4A54',
  exports: '#009F75',
  primary: '#133E68',
  grid: '#E1E4E8',
  axis: '#444A52',
  surface: '#FFFFFF',
  text: '#161616',
  finished: '#7DE2D1',
  components: '#FEB95F',
}

const DARK: Palette = {
  global: '#93B2D8',
  imports: '#D99AA3',
  exports: '#5FC2A2',
  primary: '#93B2D8',
  grid: '#2A3542',
  axis: '#A6B0BC',
  surface: '#1B2430',
  text: '#D3DAE2',
  finished: '#7DE2D1',
  components: '#FEB95F',
}

/*
 * The secret look (lib/look) keeps the original dashboard's blue and green
 * (brightened) for the two India series and a violet for Global Trade, so the three
 * still read apart. Same rule: one meaning per hue on every page.
 */
const AMAN_LIGHT: Palette = {
  global: '#6656D8',
  imports: '#2F6FB5',
  exports: '#23936C',
  primary: '#6656D8',
  grid: '#E4E4E7',
  axis: '#52525B',
  surface: '#FFFFFF',
  text: '#18181B',
  finished: '#38BDF8',
  components: '#F59E0B',
}

const AMAN_DARK: Palette = {
  global: '#A99CF0',
  imports: '#7BAEE3',
  exports: '#5CC2A0',
  primary: '#A99CF0',
  grid: '#2A2A31',
  axis: '#A7A7B0',
  surface: '#1A1A1E',
  text: '#DCDCE0',
  finished: '#38BDF8',
  components: '#FBBF24',
}

export function palette(dark: boolean): Palette {
  if (currentLook() === 'aman') return dark ? AMAN_DARK : AMAN_LIGHT

  return dark ? DARK : LIGHT
}
