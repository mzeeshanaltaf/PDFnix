/** Formatting for values shown in dialogs. */

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const

/** "1.4 MB (1,468,006 bytes)"; binary multiples, as Windows shows them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  const exact = `${Math.round(bytes).toLocaleString('en-US')} bytes`
  if (bytes < 1024) return exact
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
  return `${rounded} ${UNITS[unit]} (${exact})`
}

/** "1.4 MB": the short form of `formatBytes`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} bytes`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
  return `${rounded} ${UNITS[unit]}`
}

/** "4.2 MB → 1.1 MB (74 % smaller)". */
export function formatSaving(before: number, after: number): string {
  const percent = before > 0 ? Math.round((1 - after / before) * 100) : 0
  return `${formatSize(before)} → ${formatSize(after)} (${percent} % smaller)`
}

/** An ISO date as the user's locale writes dates; '' for none or nonsense. */
export function formatDate(iso: string | null, locale?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

const PAPER_SIZES: { name: string; width: number; height: number }[] = [
  { name: 'A3', width: 842, height: 1191 },
  { name: 'A4', width: 595, height: 842 },
  { name: 'A5', width: 420, height: 595 },
  { name: 'Letter', width: 612, height: 792 },
  { name: 'Legal', width: 612, height: 1008 },
  { name: 'Tabloid', width: 792, height: 1224 }
]

/** "210 × 297 mm (A4, portrait)" from a size in points. */
export function formatPageSize(width: number, height: number): string {
  const toMm = (points: number): number => Math.round((points / 72) * 25.4)
  const size = `${toMm(width)} × ${toMm(height)} mm`
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  const paper = PAPER_SIZES.find(
    (candidate) => Math.abs(candidate.width - short) <= 2 && Math.abs(candidate.height - long) <= 2
  )
  if (!paper) return size
  const orientation = width > height ? 'landscape' : 'portrait'
  return `${size} (${paper.name}, ${orientation})`
}
