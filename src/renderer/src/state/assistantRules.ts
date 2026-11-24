/**
 * The AI assistant's rules, kept apart from its store so they can be tested:
 * what is sent to the model, when a question continues the conversation, which
 * model is used and how the document's text is labelled. Pure.
 */

import {
  CHARS_PER_TOKEN,
  estimateTokens,
  type AiContextMode,
  type AiModel,
  type AiReasoning
} from '../../../shared/ai'

export type AssistantAction = 'simplify' | 'define' | 'ask'

/** What the user asked for: a menu action on a selection, or a typed question. */
export interface AssistantAsk {
  action: AssistantAction
  /** The selected text, if any. */
  selection?: string
  /** The (0-based) page of the selection; the tab's current page when there is none. */
  page?: number
  /** The typed question (`ask` only). */
  question?: string
}

/** The text sent to the model as the user's message. */
export function userPrompt(ask: AssistantAsk): string {
  const selection = ask.selection?.trim() ?? ''
  switch (ask.action) {
    case 'simplify':
      return `Simplify ${selection}`
    case 'define':
      return `Define ${selection}`
    case 'ask': {
      const question = ask.question?.trim() ?? ''
      return selection === '' ? question : `${question}\n\nSelected text:\n"""\n${selection}\n"""`
    }
  }
}

/** The server-side conversation that a follow-up question continues. */
export interface Conversation {
  /** The last answer's id; the next question sends it as `previousResponseId`. */
  responseId: string
  model: string
  contextMode: AiContextMode
  /** The page whose text the conversation started with (page mode). */
  page: number
  /** The context size it started with; sent again so the same instance answers. */
  contextLength: number
  /** The document's revision when it started: an edit may have changed the text. */
  revision: number
}

/** Whether the next question continues `conversation` or starts a new one. */
export function canContinue(
  conversation: Conversation | null,
  next: { model: string; contextMode: AiContextMode; page: number; revision: number }
): conversation is Conversation {
  if (!conversation) return false
  if (conversation.model !== next.model) return false
  if (conversation.contextMode !== next.contextMode) return false
  if (next.contextMode === 'page' && conversation.page !== next.page) return false
  return conversation.revision === next.revision
}

/**
 * The model to use: the one chosen in the settings if LM Studio still has
 * it, else the first loaded model, else the first one. `stale` says the
 * chosen one is gone (the caller saves the replacement). Null without models.
 */
export function resolveModel(
  models: readonly AiModel[],
  chosen: string | null
): { model: AiModel; stale: boolean } | null {
  if (models.length === 0) return null
  const named = chosen === null ? undefined : models.find((model) => model.key === chosen)
  if (named) return { model: named, stale: false }
  const model = models.find((candidate) => candidate.loadedContext !== undefined) ?? models[0]
  return { model, stale: chosen !== null }
}

/** `off` when the model can answer without reasoning first (much faster); else the default. */
export function reasoningFor(model: AiModel): AiReasoning | undefined {
  return model.reasoningOptions?.includes('off') ? 'off' : undefined
}

/** "3", "1–12": a range of 1-based page numbers from 0-based indexes. */
function pageRange(first: number, last: number): string {
  return first === last ? `${first + 1}` : `${first + 1}–${last + 1}`
}

/** What the excerpt holds, in words: "page 3", "all 40 pages", "pages 1–12 of 40". */
export function pagesLabel(options: {
  mode: AiContextMode
  /** 0-based indexes of the pages included, in order. */
  pages: readonly number[]
  pageCount: number
}): string {
  const { mode, pages, pageCount } = options
  if (pages.length === 0) return mode === 'page' ? 'this page' : 'the document'
  const first = pages[0]
  const last = pages[pages.length - 1]
  if (mode === 'page' || pages.length === 1) return `page ${first + 1}`
  if (first === 0 && last === pageCount - 1) return `all ${pageCount} pages`
  return `pages ${pageRange(first, last)} of ${pageCount}`
}

/** The document's text with each page labelled by its 1-based number. */
export function excerptText(pages: readonly { index: number; text: string }[]): string {
  return pages
    .filter((page) => page.text.trim() !== '')
    .map((page) => `--- Page ${page.index + 1} ---\n${page.text.trim()}`)
    .join('\n\n')
}

/** Characters the page labels add to the excerpt, for the budget. */
export function labelOverhead(pageCount: number): number {
  return pageCount * `--- Page ${pageCount} ---\n\n\n`.length
}

/**
 * The system prompt that starts a conversation. `pagesLabel` names what the
 * excerpt holds ("page 3", "pages 1–12 of 40"); `truncated` says that more
 * pages (or the rest of the page) were left out to fit the context.
 */
export function systemPrompt(
  excerpt: string,
  fileName: string,
  pagesLabel: string,
  truncated = false
): string {
  const rules = [
    'You are the AI assistant in PDFnix, a PDF reader.',
    `The user is reading the document "${fileName}".`,
    'Answer from the document excerpt below when it is relevant to the request.',
    "If the excerpt doesn't contain the answer, say so; you may then answer from general knowledge if that helps.",
    'Be concise. Use Markdown for formatting.',
    'A request "Simplify <text>" asks you to rewrite that text in plain, simple English.',
    'A request "Define <text>" asks what that word or phrase means, here in this document; explain it in English.',
    'Always answer "Simplify" and "Define" requests in English, even when the text or the document is in another language.',
    'Answer any other question in the language the user wrote it in (not the language of the quoted or selected text).'
  ]
  if (excerpt.trim() === '') {
    return [
      ...rules,
      '',
      `There is no excerpt: ${pagesLabel} has no text (it may be a scanned image without a text layer). If the request needs the document's text, say so.`
    ].join('\n')
  }
  const cut = truncated
    ? ' Only part of the document fits here; the rest was left out, so say so if the answer may be in the missing part.'
    : ''
  return [
    ...rules,
    '',
    `Document excerpt (${pagesLabel}), each page marked with its page number:${cut}`,
    '"""',
    excerpt,
    '"""'
  ].join('\n')
}

/** The muted line under the panel's header about what the model was given, or null. */
export function contextNote(options: {
  mode: AiContextMode
  pages: readonly { index: number; text: string }[]
  pageCount: number
  truncated: boolean
}): string | null {
  const { mode, pages, pageCount, truncated } = options
  if (pages.every((page) => page.text.trim() === '')) {
    return mode === 'page'
      ? 'This page has no text. Run Tools → Recognise Text (OCR) first.'
      : 'This document has no text. Run Tools → Recognise Text (OCR) first.'
  }
  if (!truncated) return null
  if (mode === 'page' || pages.length <= 1) {
    const first = pages[0]?.index ?? 0
    return mode === 'page'
      ? 'Only the start of this page fits in the context.'
      : `Only the start of page ${first + 1} of ${pageCount} fits in the context.`
  }
  return `Pages ${pageRange(pages[0].index, pages[pages.length - 1].index)} of ${pageCount} included`
}

/** "New conversation · Page 3 · Gemma 4 26B A4B" */
export function dividerLabel(mode: AiContextMode, page: number, modelLabel: string): string {
  const context = mode === 'page' ? `Page ${page + 1}` : 'Whole document'
  return `New conversation · ${context} · ${modelLabel}`
}

/** Tokens a system prompt and input take before the excerpt is added. */
export function promptOverhead(fileName: string, input: string, pageCount: number): number {
  const empty = systemPrompt('x', fileName, `pages 1–${pageCount} of ${pageCount}`, true)
  return estimateTokens(empty + input) + Math.ceil(labelOverhead(pageCount) / CHARS_PER_TOKEN)
}
