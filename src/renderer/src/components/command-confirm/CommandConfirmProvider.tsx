import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  CommandConfirmContext,
  type CommandConfirm,
  type CommandConfirmOptions
} from './command-confirm-context'
import { CommandList } from './CommandList'

type Request = { id: number; options: CommandConfirmOptions; resolve: (ok: boolean) => void }

/** Asks before anything runs and shows exactly what will run. */
export function CommandConfirmProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const nextIdRef = useRef(0)
  const [queue, setQueue] = useState<Request[]>([])
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const active = queue[0] ?? null
  const lastShownRef = useRef<Request | null>(null)
  if (active) {
    lastShownRef.current = active
  }
  // Why: Radix keeps the content mounted while closing; keep its text until it is gone.
  const shown = active ?? lastShownRef.current

  const confirm = useCallback<CommandConfirm>(
    (options) =>
      new Promise((resolve) => {
        const request = { id: nextIdRef.current, options, resolve }
        nextIdRef.current += 1
        setQueue((current) => [...current, request])
      }),
    []
  )

  const settle = (ok: boolean): void => {
    if (!active) {
      return
    }
    active.resolve(ok)
    setQueue((current) => current.filter((request) => request.id !== active.id))
  }

  const options = shown?.options
  return (
    <CommandConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={active !== null} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-2xl"
          data-command-confirm
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            // Why: Enter must never confirm a destructive action by accident.
            const focusTarget = active?.options.isDestructive ? cancelRef : confirmRef
            focusTarget.current?.focus()
          }}
        >
          <DialogHeader className="min-w-0">
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.details?.length ? (
              <DialogDescription className="whitespace-pre-line break-all">
                {options.details.join('\n')}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {options?.warnings?.map((warning) => (
            <p key={warning} className="text-sm break-all text-destructive">
              {warning}
            </p>
          ))}
          {options ? <CommandList commands={options.commands} /> : null}
          {options?.notes?.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" onClick={() => settle(false)}>
              {translate('commandConfirm.cancel', 'Cancel')}
            </Button>
            <Button
              ref={confirmRef}
              variant={options?.isDestructive ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CommandConfirmContext.Provider>
  )
}
