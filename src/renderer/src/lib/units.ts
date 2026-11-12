/**
 * The one place that converts between PDF points and CSS pixels.
 *
 * All engine coordinates are PDF points (1/72 inch) in the page's displayed
 * (rotated) space with the origin at the top-left. CSS pixels are 1/96 inch,
 * so `px = pt × zoom × 96/72`.
 */

export const CSS_PX_PER_PT = 96 / 72

export function ptToPx(pt: number, zoom: number): number {
  return pt * zoom * CSS_PX_PER_PT
}

export function pxToPt(px: number, zoom: number): number {
  return px / (zoom * CSS_PX_PER_PT)
}
