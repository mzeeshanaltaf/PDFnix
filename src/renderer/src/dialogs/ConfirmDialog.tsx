import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { answerConfirmation, useConfirm } from '@/state/dialogs'

/** The yes/no question asked with `confirmAction`. */
export function ConfirmDialog(): React.JSX.Element {
  const question = useConfirm((state) => state.current)
  return (
    <Dialog open={question !== null} onOpenChange={(open) => !open && answerConfirmation(false)}>
      <DialogContent className="sm:max-w-md">
        {question && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{question.title}</DialogTitle>
              <DialogDescription className="whitespace-pre-line">
                {question.message}
              </DialogDescription>
            </DialogHeader>
            {question.details && question.details.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-md border bg-muted/40 px-3 py-2 text-xs break-all">
                {question.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => answerConfirmation(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant={question.destructive ? 'destructive' : 'default'}
                onClick={() => answerConfirmation(true)}
                autoFocus
              >
                {question.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
