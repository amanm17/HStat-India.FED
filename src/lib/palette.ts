/*
 * Chart colours.
 *
 * Two categorical slots are all the dashboard needs: India imports and
 * India exports. Everything else is a single-series magnitude chart and
 * uses slot 1.
 *
 * Dark mode is a separately chosen pair, not a lightened flip of the light
 * one. Both pairs were checked against the surface they sit on for the
 * lightness band, chroma floor, colour-vision-deficiency separation, the
 * normal-vision floor and contrast:
 *
 *   light on #ffffff  worst adjacent CVD ΔE 18.0, normal ΔE 18.4
 *   dark  on #121c27  worst adjacent CVD ΔE 19.6, normal ΔE 20.9
 *
 * Both charts also carry a legend and direct labels, so identity never
 * rests on colour alone.
 */

export type Palette = {
  imports: string
  exports: string
  primary: string
  grid: string
  axis: string
  surface: string
}

const LIGHT: Palette = {
  imports: '#1f5f99',
  exports: '#2f8f6b',
  primary: '#1f5f99',
  grid: '#e3e9ee',
  axis: '#667386',
  surface: '#ffffff',
}

const DARK: Palette = {
  imports: '#3987e5',
  exports: '#199e70',
  primary: '#3987e5',
  grid: '#273646',
  axis: '#9ba9b8',
  surface: '#121c27',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}
