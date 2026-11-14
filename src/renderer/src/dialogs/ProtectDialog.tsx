import { useEffect, useState } from 'react'
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
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
import {
  engine,
  type SecurityDescription,
  type SecurityPermissions,
  type SecurityState
} from '@/api/engine'
import { passwordProblem, passwordStrength, STRENGTH_HINTS, type Strength } from '@/lib/passwords'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import { ownerPasswordNeeded, protectDocument, unprotectDocument } from '@/state/processing'
import { useTabs, type DocumentTab } from '@/state/tabs'

const PERMISSIONS: { id: keyof SecurityPermissions; label: string }[] = [
  { id: 'print', label: 'Printing' },
  { id: 'copy', label: 'Copying text and pictures' },
  { id: 'modify', label: 'Changing content and pages' },
  { id: 'annotate', label: 'Adding comments' },
  { id: 'fillForms', label: 'Filling in forms' }
]

const ALL_ALLOWED: SecurityPermissions = {
  print: true,
  copy: true,
  modify: true,
  annotate: true,
  fillForms: true
}

function describeProtection(description: SecurityDescription): string {
  if (!description.encrypted) return 'Not protected.'
  const method = description.method ? ` (${description.method})` : ''
  const restricted = PERMISSIONS.filter((item) => description.permissions?.[item.id] === false)
  const restrictions =
    restricted.length > 0
      ? ` Not allowed: ${restricted.map((item) => item.label.toLowerCase()).join(', ')}.`
      : ''
  return description.hasOpenPassword
    ? `Needs a password to open${method}.${restrictions}`
    : `Opens without a password${method}.${restrictions}`
}

function StrengthHint({ password }: { password: string }): React.JSX.Element | null {
  if (password === '') return null
  const strength: Strength = passwordStrength(password)
  const colour =
    strength === 'strong' ? 'bg-green-600' : strength === 'fair' ? 'bg-amber-500' : 'bg-destructive'
  const filled = strength === 'strong' ? 3 : strength === 'fair' ? 2 : 1
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={`h-1.5 w-6 rounded-full ${index < filled ? colour : 'bg-muted'}`}
          />
        ))}
      </span>
      {STRENGTH_HINTS[strength]}
    </div>
  )
}

function PasswordPair({
  label,
  id,
  value,
  confirmation,
  shown,
  onChange,
  onConfirmationChange
}: {
  label: string
  id: string
  value: string
  confirmation: string
  shown: boolean
  onChange: (value: string) => void
  onConfirmationChange: (value: string) => void
}): React.JSX.Element {
  const problem = confirmation !== '' || value === '' ? passwordProblem(value, confirmation) : null
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 select-text"
        />
        <Input
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="Type it again"
          aria-label={`${label}, again`}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
          className="h-8 select-text"
        />
      </div>
      <StrengthHint password={value} />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  )
}

function ProtectForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [security, setSecurity] = useState<SecurityState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openPassword, setOpenPassword] = useState('')
  const [openConfirmation, setOpenConfirmation] = useState('')
  const [restrict, setRestrict] = useState(false)
  const [ownerPassword, setOwnerPassword] = useState('')
  const [ownerConfirmation, setOwnerConfirmation] = useState('')
  const [permissions, setPermissions] = useState<SecurityPermissions>({
    ...ALL_ALLOWED,
    copy: false,
    modify: false
  })
  const [shown, setShown] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [needOwner, setNeedOwner] = useState<{ wrong: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    engine
      .security(tab.docId)
      .then((state) => {
        if (!live) return
        setSecurity(state)
        if (state.current.encrypted && !state.ownerAccess) setNeedOwner({ wrong: false })
      })
      .catch((caught: unknown) => live && setLoadError(String(caught)))
    return () => {
      live = false
    }
  }, [tab.docId])

  const close = (): void => showToolDialog('protectTabId', null)

  const openProblem = passwordProblem(openPassword, openConfirmation)
  const ownerProblem = restrict ? passwordProblem(ownerPassword, ownerConfirmation) : null
  const hasPassword = openPassword !== '' || (restrict && ownerPassword !== '')
  const canApply =
    security !== null &&
    hasPassword &&
    openProblem === null &&
    ownerProblem === null &&
    (needOwner === null || currentPassword !== '')

  const handle = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      close()
    } catch (caught) {
      const owner = ownerPasswordNeeded(caught)
      if (owner) {
        setNeedOwner(owner)
        setCurrentPassword('')
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const apply = (): Promise<void> =>
    handle(() =>
      protectDocument(tab.id, {
        ...(openPassword ? { userPassword: openPassword } : {}),
        ...(restrict && ownerPassword ? { ownerPassword } : {}),
        permissions: restrict ? permissions : ALL_ALLOWED,
        ...(needOwner ? { currentPassword } : {})
      })
    )

  const remove = (): Promise<void> =>
    handle(() => unprotectDocument(tab.id, needOwner ? currentPassword : undefined))

  const protectedNow =
    security !== null &&
    (security.current.encrypted || (security.pending !== null && security.pending.action === 'set'))

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canApply) void apply()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Protect with Password</DialogTitle>
        <DialogDescription>
          The protection is applied when {tab.fileName} is saved.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs" role="status">
        {security?.current.encrypted ? (
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <LockOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
        <span>
          {loadError
            ? `The current protection could not be read: ${loadError}`
            : security === null
              ? 'Reading the current protection…'
              : describeProtection(security.current)}
          {security?.pending &&
            (security.pending.action === 'remove'
              ? ' Not saved yet: the protection will be removed.'
              : ` Not saved yet: ${describeProtection(security.pending).toLowerCase()}`)}
        </span>
      </div>

      {needOwner && (
        <div className="grid gap-1.5">
          <label htmlFor="protect-current" className="text-[13px] font-medium">
            Current password to change permissions
          </label>
          <Input
            id="protect-current"
            type={shown ? 'text' : 'password'}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="h-8 select-text"
          />
          <p
            className={`text-xs ${needOwner.wrong ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {needOwner.wrong
              ? 'That is not the password to change permissions.'
              : 'This file was opened without its password to change permissions, which is needed to change or remove its protection.'}
          </p>
        </div>
      )}

      <PasswordPair
        label="Password to open the file"
        id="protect-open"
        value={openPassword}
        confirmation={openConfirmation}
        shown={shown}
        onChange={setOpenPassword}
        onConfirmationChange={setOpenConfirmation}
      />

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input
            type="checkbox"
            checked={restrict}
            onChange={(event) => setRestrict(event.target.checked)}
          />
          Restrict what readers may do
        </label>
        {restrict && (
          <div className="grid gap-3 border-l-2 pl-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
              {PERMISSIONS.map((item) => (
                <label key={item.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={permissions[item.id]}
                    onChange={(event) =>
                      setPermissions({ ...permissions, [item.id]: event.target.checked })
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
            <PasswordPair
              label="Password to change permissions"
              id="protect-owner"
              value={ownerPassword}
              confirmation={ownerConfirmation}
              shown={shown}
              onChange={setOwnerPassword}
              onConfirmationChange={setOwnerConfirmation}
            />
            {ownerPassword === '' && openPassword !== '' && (
              <p className="text-xs text-muted-foreground">
                Left empty, the password to open the file is used, so anyone who can open it can
                also change the permissions.
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        The password to open genuinely encrypts the file (AES-256): without it the content cannot be
        read. Permission restrictions are honoured by PDF readers by convention only; a determined
        person with other tools can ignore them. Passwords cannot be recovered if forgotten.
      </p>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter className="items-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mr-auto"
          onClick={() => setShown(!shown)}
          aria-pressed={shown}
        >
          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {shown ? 'Hide passwords' : 'Show passwords'}
        </Button>
        {protectedNow && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || (needOwner !== null && currentPassword === '')}
            onClick={() => void remove()}
          >
            Remove Protection
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canApply || busy}>
          Protect
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ProtectDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.protectTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('protectTabId', null)}
    >
      <DialogContent className="sm:max-w-lg">
        {tab && <ProtectForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
