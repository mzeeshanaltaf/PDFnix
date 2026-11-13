import { ClipboardList, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hasFillableFields, useFormFields, useForms } from '@/state/forms'
import type { DocumentTab } from '@/state/tabs'
import { confirmFormAction } from './commands'

/**
 * Shown over the top of the page view when the document has a form: field
 * highlighting, Reset and Flatten. Closing it hides it for this tab.
 */
export function FormBar({ tab }: { tab: DocumentTab }): React.JSX.Element | null {
  const fields = useFormFields(tab.id)
  const highlight = useForms((state) => state.highlight)
  const dismissed = useForms((state) => state.dismissed[tab.id] === true)
  if (dismissed || !hasFillableFields(fields)) return null
  const required = (fields ?? []).filter((field) => field.flags.required).length

  return (
    <div
      role="region"
      aria-label="Form"
      className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/95 py-1 pr-1 pl-3 text-xs shadow-md backdrop-blur"
    >
      <ClipboardList className="size-4 text-primary" aria-hidden />
      <span className="mr-1">
        This document has a form
        {required > 0 ? ` · ${required} required field${required === 1 ? '' : 's'}` : ''}
      </span>
      <Button
        variant={highlight ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={highlight}
        onClick={() => useForms.getState().setHighlight(!highlight)}
      >
        Highlight fields
      </Button>
      <Button variant="ghost" size="xs" onClick={() => void confirmFormAction(tab.id, 'reset')}>
        Reset
      </Button>
      <Button variant="ghost" size="xs" onClick={() => void confirmFormAction(tab.id, 'flatten')}>
        Flatten…
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 rounded-full"
        aria-label="Hide the form bar"
        onClick={() => useForms.getState().dismiss(tab.id)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
