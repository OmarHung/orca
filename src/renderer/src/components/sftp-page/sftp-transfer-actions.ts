import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type { ConfirmationDialogContextValue } from '../confirmation-dialog-context'
import type { SftpTransferDirection } from '../../../../shared/sftp-types'
import { baseName } from './sftp-paths'
import { useSftpTransfersStore } from './sftp-transfers-store'

export type SftpTransferInput = {
  direction: SftpTransferDirection
  targetId: string
  sources: string[]
  destinationDir: string
}

type SftpTransferDeps = {
  confirm: ConfirmationDialogContextValue
  /** Refreshes whichever pane shows the destination once files have landed. */
  onFinished: (direction: SftpTransferDirection, destinationDir: string) => void
}

const MAX_LISTED_CONFLICTS = 5

function transferLabel(sources: readonly string[]): string {
  const first = baseName(sources[0] ?? '')
  return sources.length > 1
    ? translate('sftpPage.transfer.labelMany', '{{name}} and {{count}} more', {
        name: first,
        count: sources.length - 1
      })
    : first
}

async function confirmReplace(
  confirm: ConfirmationDialogContextValue,
  conflicts: readonly string[],
  destinationDir: string
): Promise<boolean> {
  const listed = conflicts.slice(0, MAX_LISTED_CONFLICTS).join(', ')
  const more = conflicts.length - MAX_LISTED_CONFLICTS
  return confirm({
    title: translate('sftpPage.conflict.title', 'Replace existing items?'),
    description: translate(
      'sftpPage.conflict.description',
      'These already exist in {{dir}}: {{names}}{{more}}. Files are replaced and folders are merged.',
      {
        dir: destinationDir,
        names: listed,
        more:
          more > 0 ? translate('sftpPage.conflict.more', ' (+{{count}} more)', { count: more }) : ''
      }
    ),
    confirmLabel: translate('sftpPage.conflict.replace', 'Replace'),
    confirmVariant: 'destructive'
  })
}

export async function startSftpTransfer(
  input: SftpTransferInput,
  deps: SftpTransferDeps,
  overwrite = false
): Promise<void> {
  const id = createBrowserUuid()
  const store = useSftpTransfersStore.getState()
  store.begin({
    id,
    direction: input.direction,
    targetId: input.targetId,
    label: transferLabel(input.sources),
    destinationDir: input.destinationDir
  })
  const request = {
    transferId: id,
    targetId: input.targetId,
    sources: input.sources,
    destinationDir: input.destinationDir,
    overwrite
  }
  const result =
    input.direction === 'upload'
      ? await window.api.sftp.upload(request)
      : await window.api.sftp.download(request)
  if (!result.ok) {
    store.finish(id, 'failed', result.error.message)
    return
  }
  if (result.value.status === 'conflict') {
    store.discard(id)
    if (await confirmReplace(deps.confirm, result.value.conflicts, input.destinationDir)) {
      await startSftpTransfer(input, deps, true)
    }
    return
  }
  store.finish(id, result.value.status)
  if (result.value.status === 'done') {
    deps.onFinished(input.direction, input.destinationDir)
  }
}

export function cancelSftpTransfer(transferId: string): void {
  void window.api.sftp.cancel(transferId)
}
