import { translate } from '@/i18n/i18n'
import { formatBytes } from '../status-bar/workspace-space-format'
import type { CommandConfirmOptions } from '../command-confirm/command-confirm-context'
import { countSftpOperations, formatSftpOperation } from '../../../../shared/sftp-operation-format'
import type { SftpPlan } from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'

const MAX_LISTED_CONFLICTS = 5

export function sftpHostLine(
  target: Pick<SshTarget, 'label' | 'host' | 'port' | 'username'>
): string {
  const user = target.username ? `${target.username}@` : ''
  return translate('sftpPage.confirm.host', 'Host: {{label}} ({{endpoint}})', {
    label: target.label,
    endpoint: `${user}${target.host}:${target.port}`
  })
}

function listNames(names: readonly string[]): string {
  const listed = names.slice(0, MAX_LISTED_CONFLICTS).join(', ')
  const more = names.length - MAX_LISTED_CONFLICTS
  return more > 0
    ? `${listed}${translate('sftpPage.conflict.more', ' (+{{count}} more)', { count: more })}`
    : listed
}

function title(plan: SftpPlan, host: string): string {
  switch (plan.kind) {
    case 'upload':
      return translate('sftpPage.confirm.uploadTitle', 'Upload to {{host}}?', { host })
    case 'download':
      return translate('sftpPage.confirm.downloadTitle', 'Download from {{host}}?', { host })
    case 'mkdir':
      return translate('sftpPage.confirm.mkdirTitle', 'Create a folder on {{host}}?', { host })
    case 'rename':
      return translate('sftpPage.confirm.renameTitle', 'Rename on {{host}}?', { host })
    case 'move':
      return translate('sftpPage.confirm.moveTitle', 'Move on {{host}}?', { host })
    case 'remove':
      return translate('sftpPage.delete.title', 'Delete from {{host}}?', { host })
  }
}

function confirmLabel(plan: SftpPlan): string {
  switch (plan.kind) {
    case 'upload':
      return translate('sftpPage.local.upload', 'Upload')
    case 'download':
      return translate('sftpPage.remote.download', 'Download')
    case 'mkdir':
      return translate('sftpPage.remote.create', 'Create')
    case 'rename':
      return translate('sftpPage.remote.rename', 'Rename')
    case 'move':
      return translate('sftpPage.remote.move', 'Move')
    case 'remove':
      return translate('sftpPage.delete.confirm', 'Delete')
  }
}

function summary(plan: SftpPlan): string | null {
  const counts = countSftpOperations(plan.operations)
  if (plan.kind === 'upload' || plan.kind === 'download') {
    return translate(
      'sftpPage.confirm.transferSummary',
      'Files: {{files}} · Folders: {{folders}} · Size: {{size}}',
      {
        files: counts.put + counts.get,
        folders: counts.mkdir + counts.lmkdir,
        size: formatBytes(plan.totalBytes)
      }
    )
  }
  if (plan.kind === 'remove') {
    return translate(
      'sftpPage.confirm.removeSummary',
      'Files and links: {{files}} · Folders: {{folders}}',
      {
        files: counts.rm,
        folders: counts.rmdir
      }
    )
  }
  return null
}

function warnings(plan: SftpPlan): string[] {
  const result: string[] = []
  if (plan.kind === 'remove') {
    result.push(
      translate('sftpPage.confirm.removeWarning', 'Deleted permanently. This cannot be undone.')
    )
  }
  if (plan.conflicts.length === 0) {
    return result
  }
  if (plan.kind === 'rename') {
    result.push(
      translate('sftpPage.confirm.renameConflict', '“{{name}}” already exists in this folder.', {
        name: plan.conflicts[0]
      })
    )
  } else {
    result.push(
      translate(
        'sftpPage.confirm.replaceWarning',
        'Already in the destination — files are replaced, folders merged: {{names}}',
        { names: listNames(plan.conflicts) }
      )
    )
  }
  return result
}

function notes(plan: SftpPlan): string[] {
  const result = [
    translate(
      'sftpPage.confirm.legend',
      'Written as OpenSSH sftp batch commands. A leading “-” keeps a folder that already exists.'
    )
  ]
  if (plan.kind === 'download') {
    result.push(
      translate(
        'sftpPage.confirm.partialNote',
        'Each file is saved in a hidden temporary folder beside it first and moved into place when complete, so a failed download never damages an existing file.'
      )
    )
  }
  return result
}

/** Why a move was refused: OpenSSH's rename never replaces an entry that is already there. */
export function sftpMoveConflictMessage(plan: SftpPlan): string {
  return translate(
    'sftpPage.move.conflict',
    'Already in the destination folder: {{names}}. Rename or delete those first.',
    { names: listNames(plan.conflicts) }
  )
}

/** The confirm dialog for a plan; its commands are the stored plan, line for line. */
export function sftpPlanConfirmOptions(
  plan: SftpPlan,
  target: Pick<SshTarget, 'label' | 'host' | 'port' | 'username'>
): CommandConfirmOptions {
  const planSummary = summary(plan)
  return {
    title: title(plan, target.label),
    details: planSummary ? [sftpHostLine(target), planSummary] : [sftpHostLine(target)],
    warnings: warnings(plan),
    commands: plan.operations.map(formatSftpOperation),
    notes: notes(plan),
    confirmLabel: confirmLabel(plan),
    isDestructive: plan.kind === 'remove' || plan.conflicts.length > 0
  }
}
