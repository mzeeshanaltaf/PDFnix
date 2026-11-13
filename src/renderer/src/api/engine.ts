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

/** Undo/redo and save state of a document; part of most responses. */
export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  /** Name of the step Undo would take back ("Highlight"), or null. */
  undoName: string | null
  redoName: string | null
  /** The document differs from its file. */
  modified: boolean
}

export interface OpenedDocument extends HistoryState {
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

export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'squiggly'
  | 'freetext'
  | 'ink'
  | 'square'
  | 'circle'
  | 'line'
  | 'polygon'
  | 'polyline'
  | 'stamp'
  | 'caret'
  | 'attachment'
  | 'redact'
  | (string & {})

export type MarkupType = 'highlight' | 'underline' | 'strikeout'

export type FontFamily = 'sans' | 'serif' | 'mono'
export type TextAlign = 'left' | 'center' | 'right'
/** Clockwise quarter turns, as displayed. */
export type Rotation = 0 | 90 | 180 | 270

export interface TextStyle {
  fontFamily: FontFamily
  /** Points. */
  fontSize: number
  bold: boolean
  italic: boolean
  align: TextAlign
}

export interface Annotation {
  /** Stable for the life of the engine session. */
  annotId: number
  page: number
  type: AnnotationType
  /** What the annotation covers on the displayed page. */
  rect: Rect
  /** Text markup only. */
  quads?: Quad[]
  /** `#rrggbb`, or null if it has none. For free text, the text colour. */
  color: string | null
  opacity: number
  contents: string
  author: string
  /** ISO 8601, or null. */
  createdAt: string | null
  modifiedAt: string | null
  /** Shapes, ink and free text: interior (background for free text), or null. */
  fill?: string | null
  /** Shapes and ink: line width in points. */
  width?: number
  /** Lines: the two end points. */
  points?: [[number, number], [number, number]]
  arrowStart?: boolean
  arrowEnd?: boolean
  /** Free text. */
  text?: string
  fontFamily?: FontFamily
  fontSize?: number
  bold?: boolean
  italic?: boolean
  align?: TextAlign
  rotation?: Rotation
  /** Free text: its text box (equal to `rect` for boxes without a border). */
  box?: Rect
}

export type ShapeKind = 'square' | 'circle' | 'line' | 'ink'

export interface ShapeStyle {
  color: string
  fill?: string | null
  width?: number
  opacity?: number
}

export type NewAnnotation =
  | {
      type: MarkupType
      page: number
      quads: Quad[]
      color: string
      author?: string
      contents?: string
    }
  | {
      type: 'note'
      page: number
      /** Where the note's top-left corner goes. */
      point: [number, number]
      color: string
      author?: string
      contents?: string
    }
  | (ShapeStyle & {
      type: 'square' | 'circle'
      page: number
      rect: Rect
      author?: string
    })
  | (ShapeStyle & {
      type: 'line'
      page: number
      points: [[number, number], [number, number]]
      arrowStart?: boolean
      arrowEnd?: boolean
      author?: string
    })
  | (ShapeStyle & {
      type: 'ink'
      page: number
      strokes: [number, number][][]
      author?: string
    })
  | (Partial<TextStyle> & {
      type: 'freetext'
      page: number
      rect: Rect
      text: string
      /** The text colour. */
      color: string
      fill?: string | null
      opacity?: number
      rotation?: Rotation
      author?: string
    })

export interface AnnotationChange extends Partial<TextStyle> {
  contents?: string
  color?: string
  opacity?: number
  /**
   * New bounds. Notes move to its top-left corner; free text, shapes and ink
   * are moved and scaled to fill it.
   */
  rect?: Rect
  /** A colour, or null to remove the fill. */
  fill?: string | null
  width?: number
  arrowStart?: boolean
  arrowEnd?: boolean
  text?: string
  rotation?: Rotation
}

export interface TextSpan {
  text: string
  font: string
  size: number
  color: string
  /** MuPDF span flags: 2 italic, 4 serif, 8 monospaced, 16 bold. */
  flags: number
}

/** A paragraph of the page's own text that can be edited. */
export interface TextBlock {
  blockId: string
  bbox: Rect
  /** Reading direction, clockwise as displayed. */
  angle: Rotation
  text: string
  lines: { bbox: Rect; spans: TextSpan[] }[]
}

export interface PageBlocks {
  blocks: TextBlock[]
  images: { imageId: string; bbox: Rect }[]
}

export interface TextReplacement extends Partial<TextStyle> {
  /** Lines whose centre is inside it are replaced. */
  bbox: Rect
  /** Empty deletes the text. */
  text: string
  color?: string
}

export interface FontInfo {
  id: string
  name: string
  kind: 'builtin' | 'document'
  subset: boolean
}

export interface NewImage {
  rect: Rect
  rotation?: Rotation
  /** PNG, JPEG or SVG file, base64. */
  data: string
  /** More pages that get the image at the same place, in the same undo step. */
  pages?: number[]
  label?: 'Image' | 'Signature' | 'Initials'
}

export interface SavedDocument extends HistoryState {
  path: string
  fileName: string
  revision: number
}

export interface RecoveryEntry {
  recoveryId: string
  originalPath: string
  fileName: string
  isEncrypted: boolean
  pageCount: number | null
  /** ISO 8601. */
  writtenAt: string | null
  size: number
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

/** What every call that changes a document returns (also undo and redo). */
export interface MutationResult extends HistoryState {
  revision: number
  dirtyPages: number[]
  pageCount: number
  /** Size and rotation of each dirty page. */
  pages: (PageInfo & { index: number })[]
}

export type RotateResult = MutationResult

export interface AnnotationResult extends MutationResult {
  annotation: Annotation
}

export interface TextReplaceResult extends MutationResult {
  /** Set unless the text was deleted. */
  font?: string
  /** The original font could not be used. */
  substituted?: boolean
  /** Below 1 when the text was shrunk to fit. */
  fontScale?: number
  rect?: Rect
}

export interface UndoResult extends MutationResult {
  /** The step that was undone or redone. */
  undone?: string
  redone?: string
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
    }),

  /** The annotations of one page, or of the whole document. */
  annotations: (docId: string, page?: number, signal?: AbortSignal): Promise<Annotation[]> =>
    request<Annotation[]>(
      'GET',
      `${doc(docId)}/annotations${page === undefined ? '' : `?page=${page}`}`,
      { signal }
    ),

  createAnnotation: (docId: string, annotation: NewAnnotation): Promise<AnnotationResult> =>
    request<AnnotationResult>('POST', `${doc(docId)}/annotations`, { body: annotation }),

  /** `page` is where the annotation is (saves the engine a search). */
  updateAnnotation: (
    docId: string,
    annotId: number,
    page: number,
    change: AnnotationChange
  ): Promise<AnnotationResult> =>
    request<AnnotationResult>('PATCH', `${doc(docId)}/annotations/${annotId}?page=${page}`, {
      body: change
    }),

  deleteAnnotation: (docId: string, annotId: number, page: number): Promise<MutationResult> =>
    request<MutationResult>('DELETE', `${doc(docId)}/annotations/${annotId}?page=${page}`),

  /** The page content's editable text blocks and images. */
  pageBlocks: (docId: string, page: number, signal?: AbortSignal): Promise<PageBlocks> =>
    request<PageBlocks>('GET', `${doc(docId)}/pages/${page}/blocks`, { signal }),

  replaceText: (
    docId: string,
    page: number,
    replacement: TextReplacement
  ): Promise<TextReplaceResult> =>
    request<TextReplaceResult>('POST', `${doc(docId)}/pages/${page}/text/replace`, {
      body: replacement
    }),

  /** Draws an image into the page content. */
  insertImage: (docId: string, page: number, image: NewImage): Promise<MutationResult> =>
    request<MutationResult>('POST', `${doc(docId)}/pages/${page}/images`, { body: image }),

  /** Removes the text lines centred in `bbox`, or the image drawn exactly at it. */
  deleteObject: (
    docId: string,
    page: number,
    bbox: Rect,
    kind: 'text' | 'image'
  ): Promise<MutationResult> =>
    request<MutationResult>('POST', `${doc(docId)}/pages/${page}/objects/delete`, {
      body: { bbox, kind }
    }),

  /** Fonts for new text; with `docId`, also those embedded in the document. */
  fonts: (docId?: string): Promise<FontInfo[]> =>
    request<FontInfo[]>('GET', docId ? `/fonts?doc=${encodeURIComponent(docId)}` : '/fonts'),

  undo: (docId: string): Promise<UndoResult> => request<UndoResult>('POST', `${doc(docId)}/undo`),

  redo: (docId: string): Promise<UndoResult> => request<UndoResult>('POST', `${doc(docId)}/redo`),

  /**
   * Saves to the document's own file, or to `path` (Save As). Errors carry
   * codes such as `file_locked`, `file_read_only`, `disk_full`.
   */
  save: (docId: string, path?: string): Promise<SavedDocument> =>
    request<SavedDocument>('POST', `${doc(docId)}/save`, {
      body: path === undefined ? {} : { path }
    }),

  /** Recovery copies of documents with unsaved changes from an earlier run. */
  recoveryEntries: (): Promise<RecoveryEntry[]> => request<RecoveryEntry[]>('GET', '/recovery'),

  /** Opens a recovery copy like `openDocument`; the result has unsaved changes. */
  restoreRecovery: (recoveryId: string, password?: string): Promise<OpenedDocument> =>
    request<OpenedDocument>('POST', `/recovery/${encodeURIComponent(recoveryId)}/open`, {
      body: password === undefined ? {} : { password }
    }),

  discardRecovery: (recoveryId: string): Promise<{ discarded: boolean }> =>
    request('DELETE', `/recovery/${encodeURIComponent(recoveryId)}`)
}
