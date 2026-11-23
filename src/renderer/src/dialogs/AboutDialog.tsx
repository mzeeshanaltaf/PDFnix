import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AppInfo } from '../../../shared/api'
import appIcon from '@/assets/app-icon.png'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { showAbout, useDialogs } from '@/state/dialogs'
import { useEngine } from '@/state/engine'

/** The components whose licences matter most to someone reading About. */
const NOTICES: { name: string; licence: string }[] = [
  { name: 'PyMuPDF and MuPDF (Artifex Software)', licence: 'GNU AGPL v3' },
  { name: 'SumatraPDF (printing)', licence: 'GNU GPL v3' },
  { name: 'Tesseract OCR language data', licence: 'Apache 2.0' },
  {
    name: 'OpenCV, zxing-cpp, pdf2docx, FastAPI, Uvicorn, NumPy, lxml',
    licence: 'Apache 2.0, MIT, BSD'
  },
  { name: 'Python', licence: 'PSF' },
  { name: 'Electron, Chromium, React, Radix UI', licence: 'MIT, BSD and others' },
  {
    name: 'Great Vibes, Dancing Script, Allura, Sacramento fonts',
    licence: 'SIL Open Font License 1.1'
  }
]

function Row({ label, value }: { label: string; value: string | undefined }): React.JSX.Element {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums select-text">{value ?? '–'}</dd>
    </div>
  )
}

function AboutContent(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const health = useEngine((state) => state.health)

  useEffect(() => {
    let alive = true
    void window.api.app.getInfo().then((value) => {
      if (alive) setInfo(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const openNotices = async (): Promise<void> => {
    if (!(await window.api.app.openNotices())) {
      toast.error('The licence notices could not be opened', {
        description: info?.packaged
          ? 'The file is missing from the installation; reinstalling PDFnix restores it.'
          : 'Run `pnpm notices` to generate resources/licenses/THIRD-PARTY-NOTICES.txt.'
      })
    }
  }

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3">
        <img src={appIcon} alt="" className="size-12" />
        <div className="grid gap-0.5">
          <DialogTitle className="text-base">PDFnix</DialogTitle>
          <DialogDescription>
            Version {info?.version ?? '…'} · read, annotate, edit and convert PDF files
          </DialogDescription>
        </div>
      </DialogHeader>

      <section aria-label="Versions">
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-[13px] leading-5">
          <Row label="PDF engine" value={health?.engineVersion} />
          <Row label="PyMuPDF" value={health?.pymupdfVersion} />
          <Row label="MuPDF" value={health?.mupdfVersion} />
          <Row label="Python" value={health?.pythonVersion} />
          <Row label="Electron" value={info?.electron} />
          <Row label="Chromium" value={info?.chrome} />
          <Row label="Node.js" value={info?.node} />
        </dl>
        {!health && (
          <p className="mt-1 text-xs text-muted-foreground">
            The engine is not running, so its versions are not known.
          </p>
        )}
      </section>

      <section aria-label="Licences" className="grid gap-2 text-[13px]">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Open-source licences
        </h3>
        <ul className="grid gap-0.5">
          {NOTICES.map((notice) => (
            <li key={notice.name} className="flex justify-between gap-3">
              <span>{notice.name}</span>
              <span className="shrink-0 text-muted-foreground">{notice.licence}</span>
            </li>
          ))}
        </ul>
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed">
          PyMuPDF and MuPDF are licensed under the GNU Affero General Public License v3 (or a
          commercial licence from Artifex). This build of PDFnix is for personal and internal use;
          the licence terms must be revisited before it is distributed to others.
        </p>
      </section>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => void openNotices()}>
          View all licence notices
        </Button>
        <Button type="button" size="sm" onClick={() => showAbout(false)}>
          Close
        </Button>
      </DialogFooter>
    </>
  )
}

export function AboutDialog(): React.JSX.Element {
  const open = useDialogs((state) => state.aboutOpen)
  return (
    <Dialog open={open} onOpenChange={showAbout}>
      <DialogContent className="grid max-w-lg gap-4">{open && <AboutContent />}</DialogContent>
    </Dialog>
  )
}
