import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { ConfirmationDialogContextValue } from '../confirmation-dialog-context'
import type { SftpEntry, SftpResult } from '../../../../shared/sftp-types'
import { remoteJoin, remoteParent } from './sftp-paths'

const MAX_LISTED_NAMES = 5

async function reportFailure(result: Promise<SftpResult<void>>): Promise<boolean> {
  const settled = await result
  if (!settled.ok) {
    toast.error(settled.error.message)
  }
  return settled.ok
}

export async function createRemoteFolder(
  targetId: string,
  dir: string,
  name: string
): Promise<boolean> {
  return reportFailure(window.api.sftp.mkdir({ targetId, path: remoteJoin(dir, name) }))
}

export async function renameRemoteEntry(
  targetId: string,
  entry: SftpEntry,
  name: string
): Promise<boolean> {
  return reportFailure(
    window.api.sftp.rename({
      targetId,
      from: entry.path,
      to: remoteJoin(remoteParent(entry.path), name)
    })
  )
}

/** Deletes after an explicit confirmation naming the host: most of these are production servers. */
export async function deleteRemoteEntries(
  targetId: string,
  hostLabel: string,
  entries: readonly SftpEntry[],
  confirm: ConfirmationDialogContextValue
): Promise<boolean> {
  const names = entries.slice(0, MAX_LISTED_NAMES).map((entry) => entry.name)
  const more = entries.length - names.length
  const confirmed = await confirm({
    title: translate('sftpPage.delete.title', 'Delete from {{host}}?', { host: hostLabel }),
    description: translate(
      'sftpPage.delete.description',
      '{{names}}{{more}} will be deleted permanently, including everything inside folders. This cannot be undone.',
      {
        names: names.join(', '),
        more:
          more > 0 ? translate('sftpPage.conflict.more', ' (+{{count}} more)', { count: more }) : ''
      }
    ),
    confirmLabel: translate('sftpPage.delete.confirm', 'Delete'),
    confirmVariant: 'destructive'
  })
  if (!confirmed) {
    return false
  }
  return reportFailure(
    window.api.sftp.remove({ targetId, paths: entries.map((entry) => entry.path) })
  )
}
