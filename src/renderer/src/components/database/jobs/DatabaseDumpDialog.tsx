import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
  DATABASE_DUMP_MAX_ROWS_PER_INSERT,
  type DatabaseDumpOptions
} from '../../../../../shared/database/database-dump-types'
import { SelectField, TextField } from '../connection-dialog/database-form-controls'
import { buildDumpRequest, suggestedDumpName } from './database-dump-candidates'
import { CheckboxField, DumpToolField, foreignKeyOption } from './DatabaseDumpFields'
import { DatabaseDumpObjectList } from './DatabaseDumpObjectList'
import { useDatabaseJobsStore, type DatabaseDumpScope } from './database-jobs-store'
import { useDumpDialogData } from './use-dump-dialog-data'

type Contents = DatabaseDumpOptions['contents']
type Layout = DatabaseDumpOptions['layout']

const DEFAULT_ROWS_PER_INSERT = 100
const NOTHING: ReadonlySet<string> = new Set()

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
  const load = useDumpDialogData(scope)
  // Null until the user changes it: what the dialog was opened on is checked at first.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null)
  const selected = picked ?? (load.status === 'loaded' ? load.initial : NOTHING)
  const [wantsNative, setWantsNative] = useState(false)
  const [contents, setContents] = useState<Contents>(scope.dataOnly ? 'data' : 'structure-and-data')
  const [layout, setLayout] = useState<Layout>('single-file')
  const [rowsText, setRowsText] = useState(String(DEFAULT_ROWS_PER_INSERT))
  const [disableForeignKeys, setDisableForeignKeys] = useState(true)
  const [dropExisting, setDropExisting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rowsPerInsert = parseRowsPerInsert(rowsText)
  const tool = load.status === 'loaded' && load.tool.kind === 'found' ? load.tool.tool : null
  const native = wantsNative && tool !== null && tool.problem === null
  const foreignKeys = foreignKeyOption(
    native && load.status === 'loaded' ? load.tool : null,
    contents
  )
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
        disableForeignKeys: foreignKeys.locked || disableForeignKeys,
        layout,
        rowsPerInsert,
        dropExisting: contents !== 'data' && dropExisting,
        engine: native ? 'native' : 'builtin'
      })
      void useDatabaseJobsStore.getState().startDump({
        connectionId: scope.connectionId,
        source: scope.label,
        tool: native ? tool.kind : null,
        destination,
        request
      })
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
          <>
            <DatabaseDumpObjectList groups={load.groups} selected={selected} onChange={setPicked} />
            <DumpToolField choice={load.tool} native={native} onChange={setWantsNative} />
          </>
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
              description={
                native && tool.flavor !== 'postgres'
                  ? translate(
                      'database.dump.mysqldumpRows',
                      'mysqldump groups rows by size; 1 writes one row per INSERT.'
                    )
                  : undefined
              }
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
          description={foreignKeys.hint}
          checked={foreignKeys.locked || disableForeignKeys}
          disabled={foreignKeys.locked}
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
