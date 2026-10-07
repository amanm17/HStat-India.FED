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
  global: '#8DB2E0',
  imports: '#E4919B',
  exports: '#3CCB9F',
  primary: '#8DB2E0',
  grid: '#263F5C',
  axis: '#C6CFD9',
  surface: '#10233A',
  text: '#F2F5F8',
  finished: '#7DE2D1',
  components: '#FEB95F',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}
