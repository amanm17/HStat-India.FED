import { currentLook } from './look'

/*
 * Chart colours - the FED palette, one meaning per hue (execution prompt
 * §2.1), identical on every page so charts stay comparable across pages:
 *
 *   global   Indigo Dye    Global trade
 *   exports  Ming          India exports
 *   imports  English Red   India imports
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
 * The secret look (lib/look): titanium for Global trade, racing red for
 * India's imports and racing blue for its exports. Same rule: one meaning
 * per hue on every page.
 */
const AMAN_LIGHT: Palette = {
  global: '#3D4652',
  imports: '#C8102E',
  exports: '#1F4FD1',
  primary: '#3D4652',
  grid: '#E1E4E8',
  axis: '#485059',
  surface: '#FFFFFF',
  text: '#111418',
  finished: '#2AA3B8',
  components: '#D98A1C',
}

const AMAN_DARK: Palette = {
  global: '#C5CBD3',
  imports: '#FF5A67',
  exports: '#5B8EFF',
  primary: '#C5CBD3',
  grid: '#23282F',
  axis: '#A1AAB4',
  surface: '#13161A',
  text: '#E6E9ED',
  finished: '#3FBFD3',
  components: '#E9A23D',
}

export function palette(dark: boolean): Palette {
  if (currentLook() === 'aman') return dark ? AMAN_DARK : AMAN_LIGHT

  return dark ? DARK : LIGHT
}
