/**
 * The typed client for the Python engine. Every engine request made by the
 * renderer goes through this module; components never call `fetch` directly.
 *
 * Pages are addressed by 0-based index. Coordinates are PDF points in the
 * page's displayed (rotated) space, origin top-left.
 */

import type { EngineConnection } from '../../../shared/api'

const TOKEN_HEADER = 'X-Engine-Token'
const API_PREFIX = '/v1'

/** The engine answered with an error (`{ error: { code, message } }`). */
export class EngineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'EngineApiError'
  }
}

/** The engine could not be reached at all (not started, crashed, restarting). */
export class EngineUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EngineUnavailableError'
  }
}

/** True for the error `fetch` throws when its request was cancelled. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface EngineHealth {
  status: 'ok'
  engineVersion: string
  pymupdfVersion: string
  mupdfVersion: string
  pythonVersion: string
  openDocuments: number
}

/** `[x0, y0, x1, y1]` in points. */
export type Rect = [number, number, number, number]

/**
 * Four corners in points: upper-left, upper-right, lower-left, lower-right,
 * as seen along the text (`[ulx, uly, urx, ury, llx, lly, lrx, lry]`).
 */
export type Quad = [number, number, number, number, number, number, number, number]

export interface PageInfo {
  /** Size in points as displayed, that is, with the rotation applied. */
  width: number
  height: number
  rotation: number
}

export interface OpenedDocument {
  docId: string
  path: string
  fileName: string
  pageCount: number
  pages: PageInfo[]
  title: string
  isEncrypted: boolean
  hasTextLayer: boolean
  revision: number
}

export interface TextWord {
  text: string
  bbox: Rect
}

export interface TextLine {
  bbox: Rect
  /** Reading direction in degrees: 0 left to right, 90 top to bottom, and so on. */
  angle: number
  words: TextWord[]
}

export interface PageText {
  lines: TextLine[]
}

export interface OutlineEntry {
  title: string
  /** 0-based page index, or null when the entry points outside the document. */
  page: number | null
  /** 1 for top-level entries. */
  level: number
}

export interface DocumentPermissions {
  print: boolean
  printHighQuality: boolean
  modify: boolean
  copy: boolean
  annotate: boolean
  fillForms: boolean
  accessibility: boolean
  assemble: boolean
}

export interface DocumentInfo {
  path: string
  fileName: string
  fileSize: number
  pageCount: number
  pdfVersion: string | null
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  /** ISO 8601, or null when the document does not say. */
  createdAt: string | null
  modifiedAt: string | null
  isEncrypted: boolean
  encryption: string | null
  permissions: DocumentPermissions
  pageSize: { width: number; height: number }
}

export interface SearchOptions {
  matchCase: boolean
  wholeWord: boolean
}

export interface SearchHit {
  page: number
  /** One box per line the match touches. */
  quads: Quad[]
  /** Text around the match, for the result list. */
  before: string
  match: string
  after: string
}

export interface SearchResult {
  hits: SearchHit[]
  /** True when the engine stopped at its hit limit. */
  truncated: boolean
}

/** What every call that changes a document returns. */
export interface MutationResult {
  revision: number
  dirtyPages: number[]
  pageCount: number
}

export interface RotateResult extends MutationResult {
  /** The new size of each rotated page. */
  pages: (PageInfo & { index: number })[]
}

export type ImageFormat = 'auto' | 'png' | 'jpeg'

let connection: Promise<EngineConnection> | null = null

/**
 * Forgets the cached address and token. Call when the engine has been
 * restarted: the replacement listens on a new port with a new token.
 */
export function resetConnection(): void {
  connection = null
}

function getConnection(): Promise<EngineConnection> {
  connection ??= window.api.engine.getConnection()
  return connection
}

async function toApiError(response: Response): Promise<EngineApiError> {
  let code = 'http_error'
  let message = `The engine returned HTTP ${response.status}.`
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error: { code?: unknown; message?: unknown } }).error
      if (typeof error?.code === 'string') code = error.code
      if (typeof error?.message === 'string') message = error.message
    }
  } catch {
    // Not JSON; keep the generic message.
  }
  return new EngineApiError(response.status, code, message)
}

interface RequestOptions {
  body?: unknown
  /** Cancels the request; the promise then rejects with an `AbortError`. */
  signal?: AbortSignal
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  let target: EngineConnection
  try {
    target = await getConnection()
  } catch (cause) {
    resetConnection()
    throw new EngineUnavailableError('The PDF engine is not running.', { cause })
  }

  const headers: Record<string, string> = { [TOKEN_HEADER]: target.token }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${target.baseUrl}${API_PREFIX}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    })
  } catch (cause) {
    if (isAbortError(cause)) throw cause
    resetConnection()
    throw new EngineUnavailableError('The PDF engine cannot be reached.', { cause })
  }

  if (!response.ok) throw await toApiError(response)
  return response
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options)
  return (await response.json()) as T
}

function doc(docId: string): string {
  return `/docs/${encodeURIComponent(docId)}`
}

export const engine = {
  health: (): Promise<EngineHealth> => request<EngineHealth>('GET', '/health'),

  /**
   * Opens a working copy of the file. Rejects with an `EngineApiError` whose
   * code is `password_required` or `password_incorrect` for protected files.
   */
  openDocument: (path: string, password?: string): Promise<OpenedDocument> =>
    request<OpenedDocument>('POST', '/docs/open', {
      body: password === undefined ? { path } : { path, password }
    }),

  closeDocument: (docId: string): Promise<{ closed: boolean }> => request('DELETE', doc(docId)),

  /** Closes every session the engine holds. */
  closeAllDocuments: (): Promise<{ closed: number }> => request('DELETE', '/docs'),

  /** A page image. `scale` is pixels per point. */
  renderPage: async (
    docId: string,
    page: number,
    scale: number,
    options: { signal?: AbortSignal; format?: ImageFormat } = {}
  ): Promise<Blob> => {
    const query = new URLSearchParams({ scale: scale.toFixed(4) })
    if (options.format) query.set('format', options.format)
    const response = await send('GET', `${doc(docId)}/pages/${page}/render?${query}`, {
      signal: options.signal
    })
    return response.blob()
  },

  pageText: (docId: string, page: number, signal?: AbortSignal): Promise<PageText> =>
    request<PageText>('GET', `${doc(docId)}/pages/${page}/text`, { signal }),

  outline: (docId: string): Promise<OutlineEntry[]> =>
    request<OutlineEntry[]>('GET', `${doc(docId)}/outline`),

  info: (docId: string): Promise<DocumentInfo> =>
    request<DocumentInfo>('GET', `${doc(docId)}/info`),

  search: (
    docId: string,
    query: string,
    options: SearchOptions,
    signal?: AbortSignal
  ): Promise<SearchResult> =>
    request<SearchResult>('POST', `${doc(docId)}/search`, {
      body: { query, matchCase: options.matchCase, wholeWord: options.wholeWord },
      signal
    }),

  /** Rotates pages by a multiple of 90 degrees, clockwise. Omit `pages` for all. */
  rotatePages: (docId: string, degrees: number, pages?: number[]): Promise<RotateResult> =>
    request<RotateResult>('POST', `${doc(docId)}/pages/rotate`, {
      body: pages === undefined ? { degrees } : { degrees, pages }
    })
}
