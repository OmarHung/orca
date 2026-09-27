import React, { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
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
import { resolveDocumentTheme } from '@/lib/document-theme'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import type { DatabaseDdlTarget } from '../../../../../shared/database/database-ddl-types'
import { asDatabaseResult } from '../database-connections-store'
import { useDatabaseDialogsStore } from '../database-page-actions'

type DdlState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; ddl: string }

function useDdl(connectionId: string, target: DatabaseDdlTarget): DdlState {
  const [state, setState] = useState<DdlState>({ status: 'loading' })
  useEffect(() => {
    let current = true
    window.api.database.ddl(connectionId, target).then(
      (response) => {
        const result = asDatabaseResult(response)
        if (current) {
          setState(
            result.ok
              ? { status: 'loaded', ddl: result.value }
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

function DdlViewer({ ddl }: { ddl: string }): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const editorFontZoomLevel = useAppStore((state) => state.editorFontZoomLevel)
  return (
    <div className="h-[min(60vh,32rem)] overflow-hidden rounded-md border border-border">
      <Editor
        height="100%"
        language="sql"
        value={ddl}
        theme={resolveDocumentTheme(settings?.theme ?? 'system') ? 'vs-dark' : 'vs'}
        options={{
          readOnly: true,
          domReadOnly: true,
          ariaLabel: translate('database.ddl.editorLabel', 'DDL'),
          fontFamily: resolveEditorFontFamily(settings),
          fontSize: computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel),
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          stickyScroll: { enabled: false },
          padding: { top: 8, bottom: 8 }
        }}
      />
    </div>
  )
}

/** Show DDL: the CREATE statements for a table, view or routine, read-only and copyable. */
export function DatabaseDdlDialog(): React.JSX.Element | null {
  const request = useDatabaseDialogsStore((state) => state.ddlRequest)
  const close = useDatabaseDialogsStore((state) => state.closeDdl)
  if (!request) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>
            {translate('database.ddl.description', 'The statements that create this object.')}
          </DialogDescription>
        </DialogHeader>
        <DdlBody
          key={request.id}
          connectionId={request.connectionId}
          target={request.target}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  )
}

function DdlBody({
  connectionId,
  target,
  onClose
}: {
  connectionId: string
  target: DatabaseDdlTarget
  onClose: () => void
}): React.JSX.Element {
  const state = useDdl(connectionId, target)
  const copy = (ddl: string): void => {
    void window.api.ui.writeClipboardText(ddl)
    toast.success(translate('database.ddl.copied', 'DDL copied'))
  }
  return (
    <>
      {state.status === 'loading' ? (
        <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('database.ddl.loading', 'Reading the definition…')}
        </div>
      ) : null}
      {state.status === 'error' ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}
      {state.status === 'loaded' ? <DdlViewer ddl={state.ddl} /> : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {translate('database.ddl.close', 'Close')}
        </Button>
        <Button
          disabled={state.status !== 'loaded'}
          onClick={() => state.status === 'loaded' && copy(state.ddl)}
        >
          <Copy />
          {translate('database.ddl.copy', 'Copy')}
        </Button>
      </DialogFooter>
    </>
  )
}
