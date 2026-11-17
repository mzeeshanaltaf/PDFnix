import { memo } from 'react'
import { toast } from 'sonner'
import type { PageLink } from '@/api/engine'
import { confirmAction } from '@/state/dialogs'
import { useTools } from '@/state/tools'
import { externalLinkTarget } from '../../../shared/links'
import { getViewer } from './controller'
import { rectToPx } from './geometry'
import { usePageLinks } from './hooks'

/** Asks before leaving the app: a PDF can point anywhere. */
async function openWebLink(target: string): Promise<void> {
  const mail = target.startsWith('mailto:')
  const yes = await confirmAction({
    title: mail ? 'Write an e-mail?' : 'Open this link?',
    message: mail
      ? 'This link opens a new e-mail in your mail program, addressed to:'
      : 'This document links to the website below. It will open in your web browser. Only continue if you trust the document and the site.',
    details: [mail ? decodeURIComponent(target.slice('mailto:'.length).split('?')[0]) : target],
    confirmLabel: mail ? 'Open mail program' : 'Open link'
  })
  if (!yes) return
  if (!(await window.api.app.openLink(target))) {
    toast.error('Could not open the link', { description: target })
  }
}

interface LinkLayerProps {
  tabId: string
  docId: string
  page: number
  revision: number
  zoom: number
}

/**
 * The links of a page, as clickable areas over the page image. Web links ask
 * before opening the browser; links to another page of the document go there.
 * Only the select tool follows links, so the other tools still reach the page
 * under them.
 */
export const LinkLayer = memo(function LinkLayer({
  tabId,
  docId,
  page,
  revision,
  zoom
}: LinkLayerProps): React.JSX.Element | null {
  const active = useTools((state) => state.activeTool === 'select')
  const data = usePageLinks(docId, page, revision, true)
  if (!active || !data || data.links.length === 0) return null

  const follow = (link: PageLink): void => {
    if (link.kind === 'page') {
      getViewer(tabId)?.goToPage(link.page)
      return
    }
    const target = externalLinkTarget(link.uri)
    if (target) void openWebLink(target)
  }

  return (
    <div className="pdf-link-layer" data-page-index={page}>
      {data.links.map((link, index) => {
        const target = link.kind === 'uri' ? externalLinkTarget(link.uri) : null
        // Addresses the app will not open (programs, files) are not offered.
        if (link.kind === 'uri' && !target) return null
        const label = link.kind === 'page' ? `Go to page ${link.page + 1}` : target!
        // Not an <a href>: Ctrl- or middle-click on one would open the site
        // through the window-open handler without asking.
        return (
          <div
            key={index}
            role="link"
            tabIndex={0}
            className="pdf-link"
            style={rectToPx(link.rect, zoom)}
            title={label}
            aria-label={label}
            onClick={() => follow(link)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              follow(link)
            }}
          />
        )
      })}
    </div>
  )
})
