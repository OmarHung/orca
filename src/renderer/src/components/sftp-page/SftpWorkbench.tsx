import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FolderInput,
  FolderPlus,
  Pencil,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'
import { useCommandConfirm } from '../command-confirm/command-confirm-context'
import type { SftpEntry, SftpTransferDirection } from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { SftpFilePane } from './SftpFilePane'
import { SftpNameDialog, type SftpNameRequest } from './SftpNameDialog'
import { SftpRemoteMenuItems, SftpRemoteToolbar, type SftpRemoteAction } from './SftpRemoteActions'
import { SftpTransfersPanel } from './SftpTransfersPanel'
import {
  isRemotePathWithin,
  localParent,
  remoteJoin,
  remoteParent,
  resolveRemotePath
} from './sftp-paths'
import { runSftpAction, type SftpActionContext } from './sftp-plan-actions'
import { useSftpFileDrop } from './use-sftp-file-drop'
import { useSftpPaneDrag, type SftpPaneDropHandler } from './use-sftp-pane-drag'
import { useSftpPane, type SftpPaneSource } from './use-sftp-pane'

const LOCAL_SOURCE: SftpPaneSource = {
  initialPath: async () => ({ ok: true, value: await window.api.sftp.localHome() }),
  list: (path) => window.api.sftp.localList(path),
  parent: localParent
}

function isBrowsable(entry: SftpEntry): boolean {
  return entry.kind === 'directory' || entry.kind === 'symlink'
}

/** Local and remote panes for one host, with the transfers they start. */
export function SftpWorkbench({
  target,
  isActive = true,
  onRemotePathChange
}: {
  target: SshTarget
  /** False while its tab is hidden, so Finder drops only reach the tab on screen. */
  isActive?: boolean
  /** Lets the tab strip name the folder this workbench shows. */
  onRemotePathChange?: (path: string) => void
}): React.JSX.Element {
  const confirm = useCommandConfirm()
  const actionContext = useMemo<SftpActionContext>(() => ({ target, confirm }), [target, confirm])
  const remoteSource = useMemo<SftpPaneSource>(
    () => ({
      initialPath: () => window.api.sftp.home(target.id),
      list: (path) => window.api.sftp.list({ targetId: target.id, path }),
      parent: remoteParent
    }),
    [target.id]
  )
  const local = useSftpPane(LOCAL_SOURCE)
  const remote = useSftpPane(remoteSource)
  const [nameRequest, setNameRequest] = useState<SftpNameRequest | null>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const localZoneRef = useRef<HTMLDivElement>(null)

  const { refreshIfShowing: refreshLocalIfShowing } = local
  const { refreshIfShowing: refreshRemoteIfShowing, refresh: reloadRemote } = remote
  const transfer = useCallback(
    (direction: SftpTransferDirection, sources: string[], destinationDir: string | null) => {
      if (!destinationDir || sources.length === 0) {
        return
      }
      void runSftpAction(
        { kind: direction, targetId: target.id, sources, destinationDir },
        actionContext
      ).then((isDone) => {
        if (isDone) {
          if (direction === 'upload') {
            refreshRemoteIfShowing(destinationDir)
          } else {
            refreshLocalIfShowing(destinationDir)
          }
        }
      })
    },
    [actionContext, refreshLocalIfShowing, refreshRemoteIfShowing, target.id]
  )
  const runRemoteChange = (request: Parameters<typeof runSftpAction>[0]): void => {
    void runSftpAction(request, actionContext).then((isDone) => isDone && reloadRemote())
  }

  const remotePath = remote.path
  useEffect(() => {
    if (remotePath) {
      onRemotePathChange?.(remotePath)
    }
  }, [onRemotePathChange, remotePath])
  const onDropPaths = useCallback(
    (paths: string[]) => transfer('upload', paths, remotePath),
    [remotePath, transfer]
  )
  const isDropTarget = useSftpFileDrop(dropZoneRef, onDropPaths, isActive && remotePath !== null)
  const moveRemote = useCallback(
    (sources: string[], destinationDir: string) => {
      if (sources.some((source) => isRemotePathWithin(destinationDir, source))) {
        toast.error(translate('sftpPage.move.intoItself', 'A folder cannot be moved into itself.'))
        return
      }
      void runSftpAction(
        { kind: 'move', targetId: target.id, sources, destinationDir },
        actionContext
      ).then((isDone) => isDone && reloadRemote())
    },
    [actionContext, reloadRemote, target.id]
  )
  const onPaneDrop = useCallback<SftpPaneDropHandler>(
    (from, sources, to, dir) => {
      if (from === to) {
        moveRemote(sources, dir)
      } else {
        transfer(to === 'remote' ? 'upload' : 'download', sources, dir)
      }
    },
    [moveRemote, transfer]
  )
  const paneDrag = useSftpPaneDrag(
    {
      local: { zoneRef: localZoneRef, path: local.path, selected: local.selection.selected },
      remote: { zoneRef: dropZoneRef, path: remotePath, selected: remote.selection.selected }
    },
    onPaneDrop
  )

  const selectedRemote = remote.selectedEntries
  const requestNewFolder = (): void => {
    if (!remotePath) {
      return
    }
    setNameRequest({
      title: translate('sftpPage.remote.newFolder', 'New folder'),
      confirmLabel: translate('sftpPage.remote.create', 'Create'),
      initialName: '',
      onSubmit: (name) =>
        runRemoteChange({ kind: 'mkdir', targetId: target.id, path: remoteJoin(remotePath, name) })
    })
  }
  const requestRename = (): void => {
    const [entry] = selectedRemote
    if (!entry || selectedRemote.length !== 1) {
      return
    }
    setNameRequest({
      title: translate('sftpPage.remote.rename', 'Rename'),
      confirmLabel: translate('sftpPage.remote.rename', 'Rename'),
      initialName: entry.name,
      onSubmit: (name) =>
        runRemoteChange({
          kind: 'rename',
          targetId: target.id,
          from: entry.path,
          to: remoteJoin(remoteParent(entry.path), name)
        })
    })
  }
  const requestMove = (): void => {
    const [first] = selectedRemote
    if (!first || !remotePath) {
      return
    }
    const sources = selectedRemote.map((entry) => entry.path)
    setNameRequest({
      title:
        sources.length === 1
          ? translate('sftpPage.move.titleOne', 'Move “{{name}}” to…', { name: first.name })
          : translate('sftpPage.move.titleMany', 'Move {{count}} items to…', {
              count: sources.length
            }),
      confirmLabel: translate('sftpPage.remote.move', 'Move'),
      initialName: remotePath,
      inputLabel: translate('sftpPage.move.destination', 'Destination folder'),
      isValid: (value) => value.trim() !== '',
      onSubmit: (value) => moveRemote(sources, resolveRemotePath(remotePath, value))
    })
  }
  const requestDelete = (): void => {
    if (selectedRemote.length > 0) {
      runRemoteChange({
        kind: 'remove',
        targetId: target.id,
        paths: selectedRemote.map((entry) => entry.path)
      })
    }
  }

  const uploadLabel = translate('sftpPage.local.upload', 'Upload')
  const remoteActions: SftpRemoteAction[] = [
    {
      id: 'download',
      label: translate('sftpPage.remote.download', 'Download'),
      Icon: ArrowDownToLine,
      isDisabled: selectedRemote.length === 0 || local.path === null,
      run: () =>
        transfer(
          'download',
          selectedRemote.map((entry) => entry.path),
          local.path
        )
    },
    {
      id: 'newFolder',
      label: translate('sftpPage.remote.newFolder', 'New folder'),
      Icon: FolderPlus,
      isDisabled: remotePath === null,
      run: requestNewFolder
    },
    {
      id: 'rename',
      label: translate('sftpPage.remote.rename', 'Rename'),
      Icon: Pencil,
      isDisabled: selectedRemote.length !== 1,
      run: requestRename
    },
    {
      id: 'move',
      label: translate('sftpPage.remote.moveTo', 'Move to…'),
      Icon: FolderInput,
      isDisabled: selectedRemote.length === 0 || remotePath === null,
      run: requestMove
    },
    {
      id: 'delete',
      label: translate('sftpPage.remote.delete', 'Delete'),
      Icon: Trash2,
      isDisabled: selectedRemote.length === 0,
      run: requestDelete
    }
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <SftpFilePane
          paneId="local"
          title={translate('sftpPage.local.title', 'Local')}
          pane={local}
          dropZoneRef={localZoneRef}
          drag={paneDrag.local}
          onOpen={(entry) =>
            isBrowsable(entry)
              ? local.navigate(entry.path)
              : transfer('upload', [entry.path], remotePath)
          }
          actions={
            <Button
              variant="outline"
              size="xs"
              disabled={local.selectedEntries.length === 0 || remotePath === null}
              onClick={() =>
                transfer(
                  'upload',
                  local.selectedEntries.map((entry) => entry.path),
                  remotePath
                )
              }
            >
              <ArrowUpFromLine className="size-3" />
              {uploadLabel}
            </Button>
          }
        />
        <div className="w-px shrink-0 bg-border" />
        <SftpFilePane
          paneId="remote"
          title={target.label}
          pane={remote}
          dropZoneRef={dropZoneRef}
          isDropTarget={isDropTarget}
          dropHint={translate(
            'sftpPage.remote.dropHint',
            'Empty folder. Drop files here to upload.'
          )}
          onOpen={(entry) =>
            isBrowsable(entry)
              ? remote.navigate(entry.path)
              : transfer('download', [entry.path], local.path)
          }
          drag={paneDrag.remote}
          contextMenu={<SftpRemoteMenuItems actions={remoteActions} />}
          actions={<SftpRemoteToolbar actions={remoteActions} />}
        />
      </div>
      <SftpTransfersPanel />
      <SftpNameDialog request={nameRequest} onClose={() => setNameRequest(null)} />
    </div>
  )
}
