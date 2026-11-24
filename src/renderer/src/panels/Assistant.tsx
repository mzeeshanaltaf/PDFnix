import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowUp,
  ChevronDown,
  Copy,
  Eraser,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import { cn } from 'cn'
import type { AiModel } from '../../../shared/ai'
import { externalLinkTarget } from '../../../shared/links'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { shortTokens } from '@/dialogs/aiSettings'
import { copyText } from '@/lib/clipboard'
import {
  FOCUS_ASSISTANT_EVENT,
  askAssistant,
  clearAssistant,
  currentModel,
  refreshModels,
  retryAssistant,
  retryBlocked,
  setContextMode,
  setModel,
  setPendingQuote,
  stopAssistant,
  takeFocusRequest,
  useAssistant,
  type AnswerItem,
  type ChatItem,
  type ContextUsage,
  type TabAssistant,
  type UserItem
} from '@/state/assistant'
import { answerStats, usageLabel } from '@/state/assistantRules'
import { citationKey, clearCitation, showCitation, useCitation } from '@/state/citation'
import { linkCitations, parseCitationHref, type Citation } from '@/state/citationRules'
import { showPreferences } from '@/state/dialogs'
import { useSettings } from '@/state/settings'
import type { DocumentTab } from '@/state/tabs'
import { openWebLink } from '@/viewer/openLink'

const ICON_BUTTON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/75 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40'
const TEXT_BUTTON =
  'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60'
const ACTION_BUTTON =
  'inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60'
/** The input grows up to this many lines. */
const MAX_INPUT_LINES = 6
/** Within this many pixels of the end counts as "at the bottom". */
const BOTTOM_SLACK = 24

const ACTION_LABELS = { simplify: 'Simplify', define: 'Define' } as const

// --- header ------------------------------------------------------------------------

function ModelPicker(): React.JSX.Element {
  const server = useAssistant((state) => state.server)
  const chosen = useSettings((state) => state.aiModel)
  const models = server?.models ?? []
  const model = currentModel(server)
  const label = model?.label ?? (server?.reachable ? 'No model' : 'LM Studio')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Model: ${label}`}
          disabled={models.length === 0}
          className="inline-flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60 data-[state=open]:bg-accent"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Model (LM Studio)</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={chosen ?? ''}
          onValueChange={(value) => void setModel(value === '' ? null : value)}
        >
          <DropdownMenuRadioItem value="">
            <span className="flex-1">Automatic</span>
            <span className="text-xs text-muted-foreground">a loaded model first</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {models.map((item) => (
            <DropdownMenuRadioItem key={item.key} value={item.key}>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <ModelState model={item} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModelState({ model }: { model: AiModel }): React.JSX.Element {
  if (model.loadedContext === undefined) {
    return <span className="shrink-0 text-xs text-muted-foreground">loads on first use</span>
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-status-ok" aria-hidden />
      <span>
        <span className="sr-only">loaded, </span>
        {shortTokens(model.loadedContext)}
      </span>
    </span>
  )
}

function ContextToggle({ tabId, chat }: { tabId: string; chat: TabAssistant }): React.JSX.Element {
  const option = (mode: 'page' | 'document', label: string): React.JSX.Element => (
    <button
      type="button"
      aria-pressed={chat.contextMode === mode}
      onClick={() => setContextMode(tabId, mode)}
      className={cn(
        'h-6 flex-1 rounded-[5px] px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
        chat.contextMode === mode
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Context" className="flex rounded-md bg-muted p-0.5">
      {option('page', 'This page')}
      {option('document', 'Whole document')}
    </div>
  )
}

function Header({ tabId, chat }: { tabId: string; chat: TabAssistant }): React.JSX.Element {
  const loading = useAssistant((state) => state.loadingModels)
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b px-2 py-2">
      <div className="flex items-center gap-0.5">
        <ModelPicker />
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Refresh models"
          title="Refresh models"
          onClick={() => void refreshModels()}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Clear chat"
          title="Clear chat"
          disabled={chat.items.length === 0}
          onClick={() => clearAssistant(tabId)}
        >
          <Eraser className="size-3.5" aria-hidden />
        </button>
      </div>
      <ContextToggle tabId={tabId} chat={chat} />
      {chat.contextNote && (
        <p className="px-0.5 text-xs text-muted-foreground" data-testid="assistant-context-note">
          {chat.contextNote}
        </p>
      )}
    </div>
  )
}

// --- empty states ----------------------------------------------------------------

function ServerProblem({ tabId }: { tabId: string }): React.JSX.Element | null {
  const server = useAssistant((state) => state.server)
  const loading = useAssistant((state) => state.loadingModels)
  const retry = (): void => void retryBlocked(tabId)

  if (!server) {
    return loading ? (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Connecting to LM Studio…
      </p>
    ) : null
  }
  if (server.error?.code === 'unreachable') {
    return (
      <Problem
        onRetry={retry}
        settings
        text={
          <>
            LM Studio&apos;s server isn&apos;t running. Open LM Studio and start it (Developer →
            Start server), or run <code className="font-mono text-[12px]">lms server start</code>.
            To have it always available, turn on LM Studio&apos;s option to start the server at
            login.
          </>
        }
      />
    )
  }
  if (server.error?.code === 'outdated') {
    return <Problem onRetry={retry} text="Update LM Studio to version 0.4 or newer." />
  }
  if (server.error) return <Problem onRetry={retry} settings text={server.error.message} />
  if (server.models.length === 0) {
    return (
      <Problem
        onRetry={retry}
        retryLabel="Refresh"
        text="Download a model in LM Studio (Discover tab), then press Refresh."
      />
    )
  }
  return null
}

function Problem({
  text,
  onRetry,
  retryLabel = 'Retry',
  settings = false
}: {
  text: React.ReactNode
  onRetry: () => void
  retryLabel?: string
  settings?: boolean
}): React.JSX.Element {
  const loading = useAssistant((state) => state.loadingModels)
  return (
    <div role="status" className="rounded-lg border bg-muted/40 p-3 text-[13px] leading-relaxed">
      <p>{text}</p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" className={ACTION_BUTTON} onClick={onRetry} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden />
          {retryLabel}
        </button>
        {settings && (
          <button type="button" className={ACTION_BUTTON} onClick={() => showPreferences(true)}>
            <Settings className="size-3.5" aria-hidden /> Settings
          </button>
        )}
      </div>
    </div>
  )
}

function Intro({ tab }: { tab: DocumentTab }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-8 text-center text-[13px] text-muted-foreground">
      <Sparkles className="size-6 text-primary/70" aria-hidden />
      <p className="font-medium text-foreground">Ask about this document</p>
      <p>
        Select text on a page and choose Simplify, Define or Ask AI Assistant, or type a question
        below.
      </p>
      {!tab.hasTextLayer && (
        <p className="text-xs">
          This document has no text. Run Tools → Recognise Text (OCR) first.
        </p>
      )}
    </div>
  )
}

// --- messages --------------------------------------------------------------------

/** The selection, cut to three lines with "Show more". */
function Quote({ text }: { text: string }): React.JSX.Element {
  const ref = useRef<HTMLQuoteElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element && !expanded) setOverflowing(element.scrollHeight > element.clientHeight + 1)
  }, [text, expanded])
  return (
    <div>
      <blockquote
        ref={ref}
        className={cn(
          'border-l-2 border-primary/40 pl-2 text-[12.5px] whitespace-pre-wrap text-muted-foreground select-text',
          !expanded && 'line-clamp-3'
        )}
      >
        {text}
      </blockquote>
      {(overflowing || expanded) && (
        <button type="button" className={TEXT_BUTTON} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function UserMessage({ item }: { item: UserItem }): React.JSX.Element {
  const title = item.action === 'ask' ? item.question : ACTION_LABELS[item.action]
  return (
    <li className="ml-6 flex flex-col gap-1 rounded-lg bg-muted px-3 py-2" data-kind="user">
      {title && (
        <p
          className={cn(
            'text-[13px] whitespace-pre-wrap select-text',
            item.action !== 'ask' && 'font-semibold'
          )}
        >
          {title}
        </p>
      )}
      {item.selection && <Quote text={item.selection} />}
    </li>
  )
}

function CitationChip({
  tabId,
  citation,
  children
}: {
  tabId: string
  citation: Citation
  children: React.ReactNode
}): React.JSX.Element {
  const page = citation.page + 1
  const shown = useCitation((state) => state.highlight?.key === citationKey(tabId, citation))
  const quoted = citation.quote ? `Page ${page}: “${citation.quote}”` : null
  const hint = shown
    ? 'Click again or press Escape to remove the highlight'
    : 'Click to highlight it on the page'
  return (
    <button
      type="button"
      className="assistant-cite"
      title={quoted ? `${quoted}\n${hint}` : `Go to page ${page}`}
      aria-label={quoted ? `${quoted}. Highlight on the page` : `Go to page ${page}`}
      aria-pressed={quoted ? shown : undefined}
      data-testid="assistant-citation"
      onClick={() => void showCitation(tabId, citation)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && clearCitation(tabId)) event.stopPropagation()
      }}
    >
      {children}
    </button>
  )
}

/** Links open only after the same confirmation as links in a PDF. */
function WebLink({
  href,
  children
}: {
  href: string | undefined
  children: React.ReactNode
}): React.JSX.Element {
  const target = externalLinkTarget(href)
  if (!target) return <span>{children}</span>
  return (
    <span
      role="link"
      tabIndex={0}
      className="assistant-link"
      title={target}
      onClick={() => void openWebLink(target)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void openWebLink(target)
      }}
    >
      {children}
    </span>
  )
}

/** How an answer's Markdown is drawn; citation links (`#cite-…`) become page chips. */
function markdownComponents(tabId: string): Components {
  return {
    a: ({ href, children }) => {
      const citation = parseCitationHref(href)
      if (citation) {
        return (
          <CitationChip tabId={tabId} citation={citation}>
            {children}
          </CitationChip>
        )
      }
      return <WebLink href={href}>{children}</WebLink>
    },
    // Pictures from the web are not loaded (and the page's policy blocks them).
    img: ({ alt }) => <span className="text-muted-foreground">[{alt || 'image'}]</span>
  }
}

function progressText(item: AnswerItem): string {
  if (item.status) {
    const percent = Math.round(item.status.progress * 100)
    return item.status.stage === 'loading'
      ? `Loading ${item.modelLabel}… ${percent}%`
      : `Reading the document… ${percent}%`
  }
  return item.thinking ? 'Thinking…' : 'Waiting for LM Studio…'
}

function AnswerStats({ item }: { item: AnswerItem }): React.JSX.Element | null {
  const parts = answerStats(item.stats)
  if (parts.length === 0) return null
  return (
    <p
      className="ml-auto flex min-w-0 flex-wrap justify-end gap-x-2 text-[11px] text-muted-foreground tabular-nums"
      data-testid="assistant-stats"
    >
      {parts.map((part) => (
        <span key={part.title} title={part.title}>
          {part.label}
        </span>
      ))}
    </p>
  )
}

function AnswerMessage({
  tabId,
  pageCount,
  item,
  last
}: {
  tabId: string
  pageCount: number
  item: AnswerItem
  last: boolean
}): React.JSX.Element {
  const waiting = item.streaming && item.text === ''
  const components = useMemo(() => markdownComponents(tabId), [tabId])
  const markdown = useMemo(
    () => linkCitations(item.text, pageCount, item.quotePages),
    [item.text, pageCount, item.quotePages]
  )
  return (
    <li
      className="flex flex-col gap-1"
      data-kind="assistant"
      aria-busy={item.streaming}
      data-streaming={item.streaming ? 'true' : 'false'}
    >
      {waiting && (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="assistant-progress"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {progressText(item)}
        </p>
      )}
      {item.text !== '' && (
        <div className="assistant-markdown" data-testid="assistant-answer">
          <Markdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </Markdown>
        </div>
      )}
      {item.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[13px]"
        >
          <p>{item.error.message}</p>
          {last && (
            <button
              type="button"
              className={cn(ACTION_BUTTON, 'mt-2')}
              onClick={() => retryAssistant(tabId)}
            >
              <RotateCcw className="size-3.5" aria-hidden /> Retry
            </button>
          )}
        </div>
      )}
      {item.cancelled && (
        <p className="text-xs text-muted-foreground italic" data-testid="assistant-stopped">
          {item.text === '' ? 'Stopped before an answer.' : 'Stopped.'}
        </p>
      )}
      <div className="flex items-center gap-0.5">
        {item.streaming ? (
          <button type="button" className={TEXT_BUTTON} onClick={() => stopAssistant(tabId)}>
            <Square className="size-3" aria-hidden /> Stop
          </button>
        ) : (
          item.text !== '' && (
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => void copyText(item.text, 'Answer')}
            >
              <Copy className="size-3" aria-hidden /> Copy
            </button>
          )
        )}
        {!item.streaming && <AnswerStats item={item} />}
      </div>
    </li>
  )
}

function Divider({ label }: { label: string }): React.JSX.Element {
  return (
    <li role="separator" className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="max-w-[80%] truncate">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  )
}

function Messages({ tab, chat }: { tab: DocumentTab; chat: TabAssistant }): React.JSX.Element {
  const server = useAssistant((state) => state.server)
  const scroller = useRef<HTMLDivElement>(null)
  // Follow the answer as it grows, unless the user has scrolled up to read.
  const atBottom = useRef(true)
  const onScroll = (): void => {
    const element = scroller.current
    if (!element) return
    atBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK
  }
  useLayoutEffect(() => {
    const element = scroller.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [chat.items, chat.blocked])

  const answers = chat.items.filter((item) => item.kind === 'assistant')
  const lastAnswer = answers[answers.length - 1]
  const renderItem = (item: ChatItem): React.JSX.Element => {
    switch (item.kind) {
      case 'user':
        return <UserMessage key={item.id} item={item} />
      case 'assistant':
        return (
          <AnswerMessage
            key={item.id}
            tabId={tab.id}
            pageCount={tab.pageCount}
            item={item}
            last={item === lastAnswer}
          />
        )
      case 'divider':
        return <Divider key={item.id} label={item.label} />
    }
  }
  const showProblem = chat.items.length === 0 || chat.blocked !== null
  // Until LM Studio has answered, or while it cannot be used, the intro waits.
  const serverProblem = server === null || server.error !== undefined || server.models.length === 0

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      data-testid="assistant-messages"
    >
      {chat.items.length === 0 && !serverProblem && <Intro tab={tab} />}
      {chat.items.length > 0 && (
        <ol aria-label="Conversation" className="flex flex-col gap-3">
          {chat.items.map(renderItem)}
        </ol>
      )}
      {showProblem && (
        <div className={cn(chat.items.length > 0 || chat.blocked ? 'mt-3' : 'mt-6')}>
          <ServerProblem tabId={tab.id} />
        </div>
      )}
    </div>
  )
}

// --- input -----------------------------------------------------------------------

/** A ring that fills as the conversation uses up the model's context, with the numbers. */
function ContextGauge({ usage }: { usage: ContextUsage }): React.JSX.Element {
  const { text, fraction } = usageLabel(usage)
  const radius = 6
  const circumference = 2 * Math.PI * radius
  const percent = fraction * 100
  const shown = percent < 1 && percent > 0 ? '<1' : Math.round(percent).toString()
  return (
    <div
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums"
      title={`Context: ${text} tokens (${shown}% used). A new conversation starts empty.`}
      data-testid="assistant-context-usage"
    >
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="2.5" className="stroke-border" />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap={fraction > 0 ? 'round' : 'butt'}
          strokeDasharray={`${Math.max(fraction * circumference, fraction > 0 ? 0.5 : 0)} ${circumference}`}
          className={cn(
            fraction >= 0.9
              ? 'stroke-destructive'
              : fraction >= 0.7
                ? 'stroke-amber-500'
                : 'stroke-primary'
          )}
        />
      </svg>
      <span>
        <span className="sr-only">Context used: </span>
        {text}
      </span>
    </div>
  )
}

function Composer({ tab, chat }: { tab: DocumentTab; chat: TabAssistant }): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const element = input.current
    if (!element) return
    const style = getComputedStyle(element)
    const line = parseFloat(style.lineHeight) || 20
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, line * MAX_INPUT_LINES + padding)}px`
  }, [])
  useLayoutEffect(fit, [question, fit])

  useEffect(() => {
    const focus = (): void => {
      if (takeFocusRequest()) input.current?.focus()
    }
    // A request made while the panel was still opening is waiting.
    focus()
    window.addEventListener(FOCUS_ASSISTANT_EVENT, focus)
    return () => window.removeEventListener(FOCUS_ASSISTANT_EVENT, focus)
  }, [])

  const send = (): void => {
    if (question.trim() === '') return
    const quote = chat.pendingQuote
    void askAssistant(tab.id, {
      action: 'ask',
      question,
      ...(quote && { selection: quote.text, page: quote.page })
    })
    setQuestion('')
  }

  return (
    <div className="shrink-0 border-t p-2">
      {chat.pendingQuote && (
        <div
          className="mb-1.5 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5"
          data-testid="assistant-quote"
        >
          <p className="line-clamp-2 min-w-0 flex-1 border-l-2 border-primary/40 pl-1.5 text-xs text-muted-foreground">
            {chat.pendingQuote.text}
          </p>
          <button
            type="button"
            className={cn(ICON_BUTTON, 'size-5')}
            aria-label="Remove quote"
            onClick={() => setPendingQuote(tab.id, null)}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
        <textarea
          ref={input}
          rows={1}
          value={question}
          aria-label="Ask the AI assistant"
          placeholder={
            chat.pendingQuote ? 'Ask about the quoted text…' : 'Ask about this document…'
          }
          className="max-h-40 min-h-5 flex-1 resize-none bg-transparent text-[13px] leading-5 outline-none placeholder:text-muted-foreground"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        {chat.streaming ? (
          <button
            type="button"
            className={cn(ICON_BUTTON, 'bg-foreground text-background hover:bg-foreground/80')}
            aria-label="Stop"
            title="Stop"
            onClick={() => stopAssistant(tab.id)}
          >
            <Square className="size-3" fill="currentColor" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={cn(ICON_BUTTON, 'bg-primary text-primary-foreground hover:bg-primary/85')}
            aria-label="Send"
            title="Send (Enter)"
            disabled={question.trim() === ''}
            onClick={send}
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {chat.usage && (
        <div className="mt-1.5 flex justify-end px-1">
          <ContextGauge usage={chat.usage} />
        </div>
      )}
    </div>
  )
}

// --- panel -----------------------------------------------------------------------

/** The AI Assistant side panel: a chat with the user's LM Studio about the document. */
export function Assistant({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const stored = useAssistant((state) => state.tabs[tab.id])
  const defaultMode = useSettings((state) => state.aiContext)
  // A tab gets its chat with its first question; until then the defaults show.
  const chat = useMemo<TabAssistant>(
    () =>
      stored ?? {
        items: [],
        conversation: null,
        streaming: false,
        requestId: null,
        contextMode: defaultMode,
        contextNote: null,
        pendingQuote: null,
        blocked: null,
        usage: null
      },
    [stored, defaultMode]
  )

  // The model list may have changed since the panel was last open.
  useEffect(() => {
    void refreshModels()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="assistant-panel">
      <Header tabId={tab.id} chat={chat} />
      <Messages tab={tab} chat={chat} />
      <Composer tab={tab} chat={chat} />
    </div>
  )
}
