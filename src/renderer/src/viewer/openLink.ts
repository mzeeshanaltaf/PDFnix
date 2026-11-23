import { toast } from 'sonner'
import { confirmAction } from '@/state/dialogs'

/**
 * Opens a web or mail address from a document (a link, a QR code) after
 * asking: a PDF can point anywhere. `target` must already have passed
 * `externalLinkTarget`; main checks it again before opening it.
 */
export async function openWebLink(target: string): Promise<void> {
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
