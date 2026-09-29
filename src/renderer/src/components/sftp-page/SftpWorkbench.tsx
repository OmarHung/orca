import { useCallback, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '../confirmation-dialog-context'
import type { SftpEntry, SftpTransferDirection } from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { PaneIconButton, SftpFilePane } from './SftpFilePane'
import { SftpNameDialog, type SftpNameRequest } from './SftpNameDialog'
import { SftpTransfersPanel } from './SftpTransfersPanel'
import { localParent, remoteParent } from './sftp-paths'
import { createRemoteFolder, deleteRemoteEntries, renameRemoteEntry } from './sftp-remote-actions'
import { startSftpTransfer } from './sftp-transfer-actions'
import { useSftpFileDrop } from './use-sftp-file-drop'
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
  hostToggle
}: {
  target: SshTarget
  hostToggle?: React.ReactNode
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
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

  const { refreshIfShowing: refreshLocalIfShowing } = local
  const { refreshIfShowing: refreshRemoteIfShowing, refresh: reloadRemote } = remote
  const transfer = useCallback(
    (direction: SftpTransferDirection, sources: string[], destinationDir: string | null) => {
      if (!destinationDir || sources.length === 0) {
        return
      }
      void startSftpTransfer(
        { direction, targetId: target.id, sources, destinationDir },
        {
          confirm,
          onFinished: (finished, dir) =>
            finished === 'upload' ? refreshRemoteIfShowing(dir) : refreshLocalIfShowing(dir)
        }
      )
    },
    [confirm, refreshLocalIfShowing, refreshRemoteIfShowing, target.id]
  )

  const remotePath = remote.path
  const onDropPaths = useCallback(
    (paths: string[]) => transfer('upload', paths, remotePath),
    [remotePath, transfer]
  )
  const isDropTarget = useSftpFileDrop(dropZoneRef, onDropPaths, remotePath !== null)

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
        void createRemoteFolder(target.id, remotePath, name).then((ok) => ok && reloadRemote())
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
        void renameRemoteEntry(target.id, entry, name).then((ok) => ok && reloadRemote())
    })
  }
  const requestDelete = (): void => {
    void deleteRemoteEntries(target.id, target.label, selectedRemote, confirm).then(
      (ok) => ok && reloadRemote()
    )
  }

  const uploadLabel = translate('sftpPage.local.upload', 'Upload')
  const downloadLabel = translate('sftpPage.remote.download', 'Download')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <SftpFilePane
          paneId="local"
          title={translate('sftpPage.local.title', 'Local')}
          pane={local}
          leading={hostToggle}
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
          actions={
            <>
              <Button
                variant="outline"
                size="xs"
                disabled={selectedRemote.length === 0 || local.path === null}
                onClick={() =>
                  transfer(
                    'download',
                    selectedRemote.map((entry) => entry.path),
                    local.path
                  )
                }
              >
                <ArrowDownToLine className="size-3" />
                {downloadLabel}
              </Button>
              <PaneIconButton
                label={translate('sftpPage.remote.newFolder', 'New folder')}
                disabled={remotePath === null}
                onClick={requestNewFolder}
              >
                <FolderPlus className="size-3.5" />
              </PaneIconButton>
              <PaneIconButton
                label={translate('sftpPage.remote.rename', 'Rename')}
                disabled={selectedRemote.length !== 1}
                onClick={requestRename}
              >
                <Pencil className="size-3.5" />
              </PaneIconButton>
              <PaneIconButton
                label={translate('sftpPage.remote.delete', 'Delete')}
                disabled={selectedRemote.length === 0}
                onClick={requestDelete}
              >
                <Trash2 className="size-3.5" />
              </PaneIconButton>
            </>
          }
        />
      </div>
      <SftpTransfersPanel />
      <SftpNameDialog request={nameRequest} onClose={() => setNameRequest(null)} />
    </div>
  )
}
