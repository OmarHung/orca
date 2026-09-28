import React, { useEffect, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import type {
  DatabaseColumnProperties,
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySection
} from '../../../../../shared/database/database-properties-types'
import { asDatabaseResult } from '../database-connections-store'
import { useDatabaseDialogsStore } from '../database-page-actions'
import {
  columnFieldText,
  formatPropertyValue,
  propertiesAsText,
  shownColumnFields
} from './database-property-format'
import { columnFieldLabel, propertyLabel, propertySectionLabel } from './database-property-labels'

type PropertiesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; properties: DatabaseObjectProperties }

function useProperties(connectionId: string, target: DatabasePropertiesTarget): PropertiesState {
  const [state, setState] = useState<PropertiesState>({ status: 'loading' })
  useEffect(() => {
    let current = true
    window.api.database.properties(connectionId, target).then(
      (response) => {
        const result = asDatabaseResult(response)
        if (current) {
          setState(
            result.ok
              ? { status: 'loaded', properties: result.value }
              : { status: 'error', message: result.error.message }
          )
        }
      },
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
  }, [connectionId, target])
  return state
}

const HEADING_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground'

function PropertySection({ section }: { section: DatabasePropertySection }): React.JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2">
        <span className={HEADING_CLASS}>{propertySectionLabel(section.kind)}</span>
        {section.name ? <span className="text-xs font-medium">{section.name}</span> : null}
      </h3>
      <dl className="grid grid-cols-[minmax(9rem,max-content)_1fr] gap-x-6 gap-y-1.5 text-xs">
        {section.properties.map((property) => (
          <React.Fragment key={property.key}>
            <dt className="text-muted-foreground">{propertyLabel(property.key)}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">
              {formatPropertyValue(property)}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  )
}

function ColumnsTable({
  columns
}: {
  columns: readonly DatabaseColumnProperties[]
}): React.JSX.Element {
  const fields = shownColumnFields(columns)
  return (
    <section className="space-y-2">
      <h3 className={HEADING_CLASS}>{translate('database.properties.columns', 'Columns')}</h3>
      <div className="overflow-x-auto scrollbar-sleek rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              {fields.map((field) => (
                <th key={field} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">
                  {columnFieldLabel(field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column.name} className="border-t border-border/50 align-top">
                {fields.map((field) => (
                  <td key={field} className="whitespace-pre-wrap break-words px-2 py-1.5">
                    {columnFieldText(column, field)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PropertiesView({
  properties
}: {
  properties: DatabaseObjectProperties
}): React.JSX.Element {
  return (
    <div className="max-h-[min(65vh,36rem)] space-y-5 overflow-y-auto scrollbar-sleek pr-1 select-text">
      {properties.sections.map((section) => (
        <PropertySection key={`${section.kind}:${section.name ?? ''}`} section={section} />
      ))}
      {properties.columns ? <ColumnsTable columns={properties.columns} /> : null}
      {properties.notes.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {properties.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function PropertiesBody({
  connectionId,
  target,
  onClose
}: {
  connectionId: string
  target: DatabasePropertiesTarget
  onClose: () => void
}): React.JSX.Element {
  const state = useProperties(connectionId, target)
  const copy = (properties: DatabaseObjectProperties): void => {
    window.api.ui.writeClipboardText(propertiesAsText(properties)).then(
      () => toast.success(translate('database.properties.copied', 'Properties copied')),
      (error: unknown) =>
        toast.error(translate('database.properties.copyFailed', 'Copy failed'), {
          description: error instanceof Error ? error.message : String(error)
        })
    )
  }
  return (
    <>
      {state.status === 'loading' ? (
        <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('database.properties.loading', 'Reading the properties…')}
        </div>
      ) : null}
      {state.status === 'error' ? (
        <p className="text-sm text-destructive select-text">{state.message}</p>
      ) : null}
      {state.status === 'loaded' ? <PropertiesView properties={state.properties} /> : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {translate('database.properties.close', 'Close')}
        </Button>
        <Button
          disabled={state.status !== 'loaded'}
          onClick={() => state.status === 'loaded' && copy(state.properties)}
        >
          <Copy />
          {translate('database.properties.copy', 'Copy')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Properties: a server's, database's, schema's, table's or view's settings, read-only. */
export function DatabasePropertiesDialog(): React.JSX.Element | null {
  const request = useDatabaseDialogsStore((state) => state.propertiesRequest)
  const close = useDatabaseDialogsStore((state) => state.closeProperties)
  if (!request) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>
            {translate('database.properties.description', 'Settings as the server reports them.')}
          </DialogDescription>
        </DialogHeader>
        <PropertiesBody
          key={request.id}
          connectionId={request.connectionId}
          target={request.target}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  )
}
