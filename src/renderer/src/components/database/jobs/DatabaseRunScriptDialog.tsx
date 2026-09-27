import React, { useState } from 'react'
import { FileCode2, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatBytes } from '@/components/status-bar/workspace-space-format'
import { translate } from '@/i18n/i18n'
import type { DatabasePickedScripts } from '../../../../../shared/database/database-script-types'
import { SelectField, SwitchField } from '../connection-dialog/database-form-controls'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { useDatabaseJobsStore, type DatabaseScriptTarget } from './database-jobs-store'

type OnError = 'stop' | 'continue'

function ScriptFileList({ picked }: { picked: DatabasePickedScripts }): React.JSX.Element {
  const total = picked.files.reduce((sum, file) => sum + file.size, 0)
  return (
    <div className="flex flex-col gap-1.5">
      <ol
        aria-label={translate('database.runScript.files', 'Script files')}
        className="scrollbar-sleek max-h-40 overflow-y-auto rounded-md border border-border"
      >
        {picked.files.map((file, index) => (
          <li
            key={file.name}
            className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-sm last:border-b-0"
          >
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBytes(file.size)}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {translate(
          'database.runScript.order',
          '{{value0}} files, {{value1}}. They run in this order on one connection.',
          { value0: String(picked.files.length), value1: formatBytes(total) }
        )}
      </p>
    </div>
  )
}

function RunScriptForm({
  target,
  onClose
}: {
  target: DatabaseScriptTarget
  onClose: () => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<DatabasePickedScripts | null>(null)
  const [onError, setOnError] = useState<OnError>('stop')
  const [transaction, setTransaction] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (): Promise<void> => {
    const next = await window.api.database.pickScripts()
    if (next) {
      setPicked(next)
    }
  }

  const run = async (): Promise<void> => {
    if (!picked) {
      return
    }
    setStarting(true)
    setError(null)
    const connections = useDatabaseConnectionsStore.getState()
    const connected = await connections.connect(target.connectionId)
    setStarting(false)
    if (!connected) {
      // A password prompt explains itself; anything else is shown here.
      const session = useDatabaseConnectionsStore.getState().sessions[target.connectionId]
      setError(session?.state === 'error' ? (session.message ?? null) : null)
      return
    }
    void useDatabaseJobsStore
      .getState()
      .runScript(target, picked, { onError: transaction ? 'stop' : onError, transaction })
    onClose()
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{translate('database.runScript.title', 'Run SQL Script')}</DialogTitle>
        <DialogDescription>
          {translate('database.runScript.description', 'Runs on {{value0}}.', {
            value0: target.label
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Button variant="outline" className="self-start" onClick={() => void choose()}>
            <FolderOpen className="size-4" />
            {picked
              ? translate('database.runScript.chooseAgain', 'Choose Other Files…')
              : translate('database.runScript.choose', 'Choose Files…')}
          </Button>
          {picked ? <ScriptFileList picked={picked} /> : null}
        </div>
        <SelectField<OnError>
          label={translate('database.runScript.onError', 'When a statement fails')}
          value={transaction ? 'stop' : onError}
          disabled={transaction}
          options={[
            { value: 'stop', label: translate('database.runScript.stop', 'Stop') },
            {
              value: 'continue',
              label: translate('database.runScript.continue', 'Keep going and list the errors')
            }
          ]}
          onChange={setOnError}
        />
        <SwitchField
          label={translate(
            'database.runScript.transaction',
            'Run in one transaction (rolled back if anything fails)'
          )}
          checked={transaction}
          onChange={setTransaction}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {translate('database.runScript.cancel', 'Cancel')}
        </Button>
        <Button disabled={!picked || starting} onClick={() => void run()}>
          {translate('database.runScript.run', 'Run')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function DatabaseRunScriptDialog(): React.JSX.Element | null {
  const target = useDatabaseJobsStore((state) => state.scriptTarget)
  const close = useDatabaseJobsStore((state) => state.closeRunScript)
  if (!target) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <RunScriptForm
        key={`${target.connectionId}:${target.database ?? ''}:${target.schema ?? ''}`}
        target={target}
        onClose={close}
      />
    </Dialog>
  )
}
