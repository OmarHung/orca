import React, { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
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
  DATABASE_DRIVER_NAMES,
  type DatabaseConnectionSummary
} from '../../../../../shared/database/database-connection-types'
import type { DatabaseEncryptionStatus } from '../../../../../shared/database/database-session-types'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import { DatabaseConnectionForm } from './DatabaseConnectionForm'
import {
  changeConnectionDriver,
  initialConnectionForm,
  parseConnectionForm,
  passwordToSave,
  type DatabaseConnectionFormState
} from './database-connection-form-state'

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; serverVersion: string }
  | { status: 'failed'; message: string }

function TestResult({ state }: { state: TestState }): React.JSX.Element | null {
  if (state.status === 'testing') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {translate('database.connectionDialog.testing', 'Connecting…')}
      </span>
    )
  }
  if (state.status === 'ok') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheck className="size-3.5" />
        {translate('database.connectionDialog.testOk', 'Connected to {{value0}}', {
          value0: state.serverVersion
        })}
      </span>
    )
  }
  if (state.status === 'failed') {
    return (
      <span className="flex min-w-0 items-start gap-1.5 text-xs text-destructive">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-words">{state.message}</span>
      </span>
    )
  }
  return null
}

export function DatabaseConnectionDialog({
  existing,
  onClose
}: {
  existing: DatabaseConnectionSummary | null
  onClose: () => void
}): React.JSX.Element {
  const [encryption, setEncryption] = useState<DatabaseEncryptionStatus | null>(null)
  const [form, setForm] = useState<DatabaseConnectionFormState>(() =>
    initialConnectionForm(existing, true)
  )
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const parsed = parseConnectionForm(form)

  useEffect(() => {
    void Promise.resolve(window.api.database.encryptionStatus()).then((status) => {
      if (!status) {
        return
      }
      setEncryption(status)
      if (!existing && !status.canStorePasswords) {
        setForm((current) => ({ ...current, passwordStorage: 'session' }))
      }
    })
  }, [existing])

  const update = (patch: Partial<DatabaseConnectionFormState>): void => {
    setForm((current) => ({ ...current, ...patch }))
    setTest({ status: 'idle' })
    setSaveError(null)
  }

  const runTest = async (): Promise<void> => {
    if (!parsed.ok) {
      return
    }
    setTest({ status: 'testing' })
    const result = asDatabaseResult(
      await window.api.database.testConnection({
        draft: parsed.draft,
        password: passwordToSave(form),
        connectionId: existing?.id
      })
    )
    setTest(
      result.ok
        ? {
            status: 'ok',
            serverVersion: `${DATABASE_DRIVER_NAMES[form.driver]} ${result.value.serverVersion}`
          }
        : { status: 'failed', message: result.error.message }
    )
  }

  const save = async (): Promise<void> => {
    if (!parsed.ok || saving) {
      return
    }
    setSaving(true)
    const result = asDatabaseResult(
      await window.api.database.saveConnection({
        id: existing?.id,
        draft: parsed.draft,
        password: passwordToSave(form)
      })
    )
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error.message)
      return
    }
    await useDatabaseConnectionsStore.getState().refresh()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Why: a stray click outside would discard a half-filled form; Cancel / × / Esc still close it. */}
      <DialogContent className="sm:max-w-lg" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {existing
              ? translate('database.connectionDialog.editTitle', 'Edit Connection')
              : translate('database.connectionDialog.newTitle', 'New Connection')}
          </DialogTitle>
          <DialogDescription>
            {form.driver === 'sqlite'
              ? translate(
                  'database.connectionDialog.sqliteDescription',
                  'Opens a database file on this computer.'
                )
              : translate(
                  'database.connectionDialog.description',
                  'Connections run from this computer. The password is never shown again after you save it.'
                )}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="space-y-4"
        >
          <DatabaseConnectionForm
            form={form}
            invalid={parsed.ok ? new Set() : parsed.invalidFields}
            hasSavedPassword={existing?.hasSavedPassword ?? false}
            encryption={encryption}
            driverLocked={existing !== null}
            onDriverChange={(driver) => {
              setForm((current) => changeConnectionDriver(current, driver))
              setTest({ status: 'idle' })
              setSaveError(null)
            }}
            onChange={update}
          />
          <div className="min-h-5">
            {saveError ? (
              <TestResult state={{ status: 'failed', message: saveError }} />
            ) : (
              <TestResult state={test} />
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={!parsed.ok || test.status === 'testing'}
              onClick={() => void runTest()}
            >
              {translate('database.connectionDialog.test', 'Test Connection')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {translate('database.connectionDialog.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={!parsed.ok || saving}>
                {translate('database.connectionDialog.save', 'Save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
