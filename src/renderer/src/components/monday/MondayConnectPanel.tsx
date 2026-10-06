import React, { useState } from 'react'
import { CalendarRange, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { MONDAY_TOKEN_HELP_URL, type MondayError } from '../../../../shared/monday/monday-types'
import { openMondayLink } from './monday-browser-actions'
import { connectMonday } from './monday-page-actions'
import { mondayErrorMessage } from './monday-error-message'

export function MondayConnectPanel(): React.JSX.Element {
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MondayError | null>(null)
  const canSubmit = token.trim().length > 0 && !pending

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setPending(true)
    setError(null)
    const failure = await connectMonday(token.trim())
    setPending(false)
    if (failure) {
      setError(failure)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-card-foreground"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
            <CalendarRange className="size-4 text-muted-foreground" />
          </div>
          <h2 className="text-base font-semibold">
            {translate('monday.connect.title', 'Connect monday')}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {translate(
            'monday.connect.description',
            'See timelines and due dates together, and open any item without leaving the calendar. Orca only reads monday.'
          )}
        </p>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="monday-token">
              {translate('monday.connect.tokenLabel', 'Personal API token')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'monday.connect.tokenHelp',
                'In monday, open your avatar menu → Developers → My access tokens, then copy the token.'
              )}
            </p>
          </div>
          <Input
            id="monday-token"
            type="password"
            autoFocus
            autoComplete="off"
            value={token}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setToken(event.target.value)}
          />
          {error ? <p className="text-xs text-destructive">{mondayErrorMessage(error)}</p> : null}
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'monday.connect.storage',
              'The token stays on this computer and is only sent to monday.'
            )}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            onClick={(event) =>
              openMondayLink(MONDAY_TOKEN_HELP_URL, { systemBrowser: event.shiftKey })
            }
          >
            {translate('monday.connect.docs', 'About monday API tokens')}
            <ExternalLink className="size-3" />
          </button>
          <Button type="submit" disabled={!canSubmit} className="w-24">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {translate('monday.connect.submit', 'Connect')}
          </Button>
        </div>
      </form>
    </div>
  )
}
