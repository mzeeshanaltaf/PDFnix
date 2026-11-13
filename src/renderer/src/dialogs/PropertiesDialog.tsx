import { useEffect, useState } from 'react'
import { engine, type DocumentInfo, type DocumentPermissions } from '@/api/engine'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { showProperties, useDialogs } from '@/state/dialogs'
import { getTab } from '@/state/tabs'
import { formatBytes, formatDate, formatPageSize } from './format'

const PERMISSIONS: { key: keyof DocumentPermissions; label: string }[] = [
  { key: 'print', label: 'Printing' },
  { key: 'copy', label: 'Copying text and images' },
  { key: 'modify', label: 'Changing the document' },
  { key: 'annotate', label: 'Commenting' },
  { key: 'fillForms', label: 'Filling in forms' },
  { key: 'assemble', label: 'Inserting, deleting and rotating pages' }
]

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words select-text">{children || '–'}</dd>
    </div>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1 text-[13px] leading-5">
        {children}
      </dl>
    </section>
  )
}

function Details({ info }: { info: DocumentInfo }): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <Section title="File">
        <Row label="Name">{info.fileName}</Row>
        <Row label="Location">{info.path}</Row>
        <Row label="Size">{formatBytes(info.fileSize)}</Row>
        <Row label="Pages">{info.pageCount.toLocaleString()}</Row>
        <Row label="Page size">{formatPageSize(info.pageSize.width, info.pageSize.height)}</Row>
        <Row label="PDF version">{info.pdfVersion}</Row>
      </Section>
      <Section title="Description">
        <Row label="Title">{info.title}</Row>
        <Row label="Author">{info.author}</Row>
        <Row label="Subject">{info.subject}</Row>
        <Row label="Keywords">{info.keywords}</Row>
        <Row label="Created">{formatDate(info.createdAt)}</Row>
        <Row label="Modified">{formatDate(info.modifiedAt)}</Row>
        <Row label="Application">{info.creator}</Row>
        <Row label="PDF producer">{info.producer}</Row>
      </Section>
      <Section title="Security">
        <Row label="Protection">
          {info.isEncrypted
            ? `Password protected${info.encryption ? ` (${info.encryption})` : ''}`
            : (info.encryption ?? 'None')}
        </Row>
        {PERMISSIONS.map(({ key, label }) => (
          <Row key={key} label={label}>
            {info.permissions[key] ? 'Allowed' : 'Not allowed'}
          </Row>
        ))}
      </Section>
    </div>
  )
}

type Loaded = { tabId: string; info: DocumentInfo } | { tabId: string; error: string }

/** File > Properties: facts about the file, its description and its protection. */
export function PropertiesDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.propertiesTabId)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    const tab = tabId ? getTab(tabId) : null
    if (!tab) return
    let cancelled = false
    engine.info(tab.docId).then(
      (info) => {
        if (!cancelled) setLoaded({ tabId: tab.id, info })
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoaded({
            tabId: tab.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [tabId])

  // What was loaded for another document is not shown for this one.
  const current = loaded && loaded.tabId === tabId ? loaded : null

  return (
    <Dialog
      open={tabId !== null}
      onOpenChange={(open) => {
        if (!open) showProperties(null)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">Document properties</DialogTitle>
          <DialogDescription className="sr-only">
            Details about the file, its description and its protection.
          </DialogDescription>
        </DialogHeader>
        {current === null && <p className="text-[13px] text-muted-foreground">Loading…</p>}
        {current !== null && 'error' in current && (
          <p role="alert" className="text-[13px] text-destructive">
            The properties could not be read: {current.error}
          </p>
        )}
        {current !== null && 'info' in current && <Details info={current.info} />}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
