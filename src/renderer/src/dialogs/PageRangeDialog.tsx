import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { parsePageRanges } from '@/lib/pageRanges'
import { answerPageRange, useRangePrompt, type RangeQuestion } from '@/state/dialogs'

function RangeForm({ question }: { question: RangeQuestion }): React.JSX.Element {
  const [text, setText] = useState(question.initial)
  const parsed = parsePageRanges(text, question.pageCount)
  const [touched, setTouched] = useState(false)
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (parsed.ok) answerPageRange(parsed.pages)
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">{question.title}</DialogTitle>
        <DialogDescription>{question.description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor="page-range" className="text-[13px] font-medium">
          Pages (1 to {question.pageCount})
        </label>
        <Input
          id="page-range"
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. 1-3, 7, 10-"
          className="select-text"
          aria-invalid={touched && !parsed.ok}
        />
        <p className="min-h-4 text-xs text-destructive" role="alert">
          {touched && !parsed.ok ? parsed.error : ''}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => answerPageRange(null)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!parsed.ok}>
          {question.confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The page range asked for with `askPageRange`. */
export function PageRangeDialog(): React.JSX.Element {
  const question = useRangePrompt((state) => state.current)
  return (
    <Dialog open={question !== null} onOpenChange={(open) => !open && answerPageRange(null)}>
      <DialogContent className="sm:max-w-sm">
        {question && <RangeForm question={question} />}
      </DialogContent>
    </Dialog>
  )
}
