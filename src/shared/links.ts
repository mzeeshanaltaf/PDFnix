/**
 * Which web addresses from a PDF the app will open. Used by the renderer to
 * decide which links to offer and by main again before it opens one, so a
 * renderer cannot get anything else past it.
 */

/** Schemes a PDF link may open: web pages and new e-mails, nothing that runs or reads files. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const MAX_LENGTH = 4096

/**
 * The address to open for a link's URI, or null if it must not be opened.
 * Addresses written without a scheme ("www.example.com") are taken as https.
 */
export function externalLinkTarget(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let text = raw.trim()
  if (!text || text.length > MAX_LENGTH) return null
  // Control characters have no business in a link and can disguise one.
  if ([...text].some((char) => char <= '\u001f' || char === '\u007f')) return null
  if (/^www\./i.test(text)) text = `https://${text}`

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
  if (url.protocol === 'mailto:') return url.pathname ? url.href : null
  return url.hostname ? url.href : null
}
