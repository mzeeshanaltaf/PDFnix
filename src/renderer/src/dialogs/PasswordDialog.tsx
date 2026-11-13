import { useState } from 'react'
import { Lock } from 'lucide-react'
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
import { cancelPassword, submitPassword, useDialogs, type PasswordPrompt } from '@/state/dialogs'

function PasswordForm({ prompt }: { prompt: PasswordPrompt }): React.JSX.Element {
  const [password, setPassword] = useState('')
  const { fileName, wrong, checking } = prompt

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (password !== '' && !checking) submitPassword(password)
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          Password required
        </DialogTitle>
        <DialogDescription>
          <span className="font-medium break-all text-foreground">{fileName}</span> is protected.
          Enter its password to open it.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Input
          type="password"
          aria-label="Password"
          aria-invalid={wrong || undefined}
          aria-describedby={wrong ? 'password-error' : undefined}
          autoFocus
          autoComplete="off"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="select-text"
        />
        {wrong && (
          <p id="password-error" role="alert" className="text-[13px] text-destructive">
            That password is not correct. Try again.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={cancelPassword}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={password === '' || checking}>
          {checking ? 'Opening…' : 'Open'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Asks for the password of a protected file, again if it was wrong. */
export function PasswordDialog(): React.JSX.Element {
  const prompt = useDialogs((state) => state.password)

  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) cancelPassword()
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {/* A new attempt starts with an empty box. */}
        {prompt && <PasswordForm key={prompt.attempt} prompt={prompt} />}
      </DialogContent>
    </Dialog>
  )
}
