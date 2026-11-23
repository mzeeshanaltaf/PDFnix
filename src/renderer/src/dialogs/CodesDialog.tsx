import { useEffect } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { copyText } from '@/lib/clipboard'
import { codesAsText } from '@/panels/codeRows'
import { CodeList, ScanStatus } from '@/panels/Codes'
import { showCodes, useDialogs } from '@/state/dialogs'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { describeCodes, requestCodeScan, useTabCodes } from '@/viewer/codeScan'

function CodesContent({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const { codes, progress } = useTabCodes(tab)
  useEffect(() => requestCodeScan(tab.id), [tab.id])

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">QR codes and barcodes</DialogTitle>
        <DialogDescription>
          {progress.done
            ? codes.length > 0
              ? `${describeCodes(codes.map((found) => found.code))} in ${tab.fileName}`
              : `None in ${tab.fileName}`
            : tab.fileName}
        </DialogDescription>
      </DialogHeader>
      <ScanStatus progress={progress} />
      <div className="max-h-[55vh] min-h-24 overflow-y-auto pr-1">
        <CodeList
          tab={tab}
          found={codes}
          progress={progress}
          clamp={false}
          onReveal={() => showCodes(null)}
        />
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={codes.length === 0}
          onClick={() => void copyText(codesAsText(codes), 'All codes')}
        >
          <Copy aria-hidden /> Copy all
        </Button>
        <Button type="button" size="sm" onClick={() => showCodes(null)}>
          Close
        </Button>
      </DialogFooter>
    </>
  )
}

/** The codes found in a document, opened from the toast or Tools → QR Codes and Barcodes. */
export function CodesDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.codesTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  const open = tab !== null
  return (
    <Dialog open={open} onOpenChange={(next) => !next && showCodes(null)}>
      <DialogContent className="grid gap-3 sm:max-w-lg">
        {tab && <CodesContent tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
