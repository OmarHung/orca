import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  DATABASE_DUMP_MAX_ROWS_PER_INSERT,
  type DatabaseDumpOptions
} from '../../../../../shared/database/database-dump-types'
import { SelectField, TextField } from '../connection-dialog/database-form-controls'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import {
  buildDumpRequest,
  initialDumpSelection,
  loadDumpCandidates,
  suggestedDumpName,
  type DumpCandidateGroup
} from './database-dump-candidates'
import { DatabaseDumpObjectList } from './DatabaseDumpObjectList'
import { useDatabaseJobsStore, type DatabaseDumpScope } from './database-jobs-store'

type Contents = DatabaseDumpOptions['contents']
type Layout = DatabaseDumpOptions['layout']

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; groups: DumpCandidateGroup[]; initial: ReadonlySet<string> }

const DEFAULT_ROWS_PER_INSERT = 100
const NOTHING: ReadonlySet<string> = new Set()

function useDumpCandidates(scope: DatabaseDumpScope): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  useEffect(() => {
    let current = true
    const load = async (): Promise<void> => {
      const connected = await useDatabaseConnectionsStore.getState().connect(scope.connectionId)
      if (!connected) {
        const session = useDatabaseConnectionsStore.getState().sessions[scope.connectionId]
        throw new Error(
          session?.message ?? translate('database.dump.notConnected', 'Connect to list objects.')
        )
      }
      const groups = await loadDumpCandidates(scope)
      if (current) {
        setState({ status: 'loaded', groups, initial: initialDumpSelection(groups, scope.only) })
      }
    }
    load().catch(
      (error: unknown) =>
        current &&
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
    )
    return () => {
      current = false
    }
  }, [scope])
  return state
}

function CheckboxField({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2.5">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

function parseRowsPerInsert(text: string): number | null {
  const value = Number(text)
  return Number.isInteger(value) && value >= 1 && value <= DATABASE_DUMP_MAX_ROWS_PER_INSERT
    ? value
    : null
}

function DumpForm({
  scope,
  onClose
}: {
  scope: DatabaseDumpScope
  onClose: () => void
}): React.JSX.Element {
  const load = useDumpCandidates(scope)
  // Null until the user changes it: what the dialog was opened on is checked at first.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null)
  const selected = picked ?? (load.status === 'loaded' ? load.initial : NOTHING)
  const [contents, setContents] = useState<Contents>(scope.dataOnly ? 'data' : 'structure-and-data')
  const [layout, setLayout] = useState<Layout>('single-file')
  const [rowsText, setRowsText] = useState(String(DEFAULT_ROWS_PER_INSERT))
  const [disableForeignKeys, setDisableForeignKeys] = useState(true)
  const [dropExisting, setDropExisting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rowsPerInsert = parseRowsPerInsert(rowsText)
  const canStart =
    load.status === 'loaded' && selected.size > 0 && rowsPerInsert !== null && !starting

  const start = async (): Promise<void> => {
    if (load.status !== 'loaded' || rowsPerInsert === null) {
      return
    }
    setStarting(true)
    setError(null)
    try {
      const destination = await window.api.database.pickDumpDestination({
        layout,
        suggestedName: suggestedDumpName(scope, new Date())
      })
      if (!destination) {
        return
      }
      const request = buildDumpRequest(scope, load.groups, selected, {
        contents,
        disableForeignKeys,
        layout,
        rowsPerInsert,
        dropExisting: contents !== 'data' && dropExisting
      })
      void useDatabaseJobsStore
        .getState()
        .startDump({ connectionId: scope.connectionId, source: scope.label, destination, request })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setStarting(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {scope.dataOnly
            ? translate('database.dump.exportTitle', 'Export Data')
            : translate('database.dump.title', 'Dump to SQL')}
        </DialogTitle>
        <DialogDescription>
          {scope.dataOnly
            ? translate(
                'database.dump.exportDescription',
                'Reads {{value0}} and writes its rows as SQL INSERT statements.',
                { value0: scope.label }
              )
            : translate(
                'database.dump.description',
                'Reads {{value0}} and writes SQL statements that recreate it.',
                { value0: scope.label }
              )}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        {load.status === 'loading' ? (
          <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate('database.dump.loading', 'Loading objects…')}
          </div>
        ) : load.status === 'error' ? (
          <p className="text-sm text-destructive">{load.message}</p>
        ) : (
          <DatabaseDumpObjectList groups={load.groups} selected={selected} onChange={setPicked} />
        )}
        <div className="grid grid-cols-2 gap-3">
          {scope.dataOnly ? null : (
            <SelectField<Contents>
              label={translate('database.dump.contents', 'Contents')}
              value={contents}
              options={[
                {
                  value: 'structure-and-data',
                  label: translate('database.dump.structureAndData', 'Structure and data')
                },
                {
                  value: 'structure',
                  label: translate('database.dump.structureOnly', 'Structure only')
                },
                { value: 'data', label: translate('database.dump.dataOnly', 'Data only') }
              ]}
              onChange={setContents}
            />
          )}
          <SelectField<Layout>
            label={translate('database.dump.layout', 'Files')}
            value={layout}
            options={[
              { value: 'single-file', label: translate('database.dump.singleFile', 'One file') },
              {
                value: 'file-per-table',
                label: translate('database.dump.filePerTable', 'One file per table')
              }
            ]}
            onChange={setLayout}
          />
          {contents === 'structure' ? null : (
            <TextField
              label={translate('database.dump.rowsPerInsert', 'Rows per INSERT')}
              type="number"
              min={1}
              max={DATABASE_DUMP_MAX_ROWS_PER_INSERT}
              value={rowsText}
              aria-invalid={rowsPerInsert === null}
              onChange={(event) => setRowsText(event.target.value)}
            />
          )}
        </div>
        <CheckboxField
          label={translate('database.dump.disableForeignKeys', 'Disable foreign key checks')}
          description={translate(
            'database.dump.disableForeignKeysHint',
            'Lets the file load in any table order without foreign key errors.'
          )}
          checked={disableForeignKeys}
          onChange={setDisableForeignKeys}
        />
        {contents === 'data' ? null : (
          <CheckboxField
            label={translate('database.dump.dropExisting', 'Drop existing objects first')}
            description={translate(
              'database.dump.dropExistingHint',
              'Adds DROP … IF EXISTS before each CREATE, for loading over an earlier copy.'
            )}
            checked={dropExisting}
            onChange={setDropExisting}
          />
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {translate('database.dump.cancel', 'Cancel')}
        </Button>
        <Button disabled={!canStart} onClick={() => void start()}>
          {layout === 'single-file'
            ? translate('database.dump.saveAs', 'Save As…')
            : translate('database.dump.chooseFolder', 'Choose Folder…')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function DatabaseDumpDialog(): React.JSX.Element | null {
  const scope = useDatabaseJobsStore((state) => state.dumpScope)
  const close = useDatabaseJobsStore((state) => state.closeDump)
  if (!scope) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DumpForm key={JSON.stringify(scope)} scope={scope} onClose={close} />
    </Dialog>
  )
}
