import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type { CommandConfirm } from '../command-confirm/command-confirm-context'
import type { SftpPlan, SftpPlanRequest } from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { baseName } from './sftp-paths'
import { sftpMoveConflictMessage, sftpPlanConfirmOptions } from './sftp-plan-confirm'
import { useSftpTransfersStore } from './sftp-transfers-store'

export type SftpActionContext = {
  target: SshTarget
  confirm: CommandConfirm
}

function transferLabel(sources: readonly string[]): string {
  const first = baseName(sources[0] ?? '')
  return sources.length > 1
    ? translate('sftpPage.transfer.labelMany', '{{name}} and {{count}} more', {
        name: first,
        count: sources.length - 1
      })
    : first
}

async function executeTransfer(
  plan: SftpPlan,
  request: Extract<SftpPlanRequest, { kind: 'upload' | 'download' }>
): Promise<boolean> {
  const id = createBrowserUuid()
  const store = useSftpTransfersStore.getState()
  store.begin({
    id,
    direction: request.kind,
    targetId: request.targetId,
    label: transferLabel(request.sources),
    destinationDir: request.destinationDir
  })
  const result = await window.api.sftp.execute({ planId: plan.planId, transferId: id })
  if (!result.ok) {
    store.finish(id, 'failed', result.error.message)
    return false
  }
  store.finish(id, result.value.status)
  return result.value.status === 'done'
}

/**
 * Plans the action in main, shows every command it will run, and runs that same stored plan
 * only if the user confirms. Resolves true once the change has been made.
 */
export async function runSftpAction(
  request: SftpPlanRequest,
  context: SftpActionContext
): Promise<boolean> {
  const planned = await window.api.sftp.plan(request)
  if (!planned.ok) {
    toast.error(planned.error.message)
    return false
  }
  const plan = planned.value
  if (request.kind === 'move' && plan.conflicts.length > 0) {
    void window.api.sftp.discardPlan(plan.planId)
    toast.error(sftpMoveConflictMessage(plan))
    return false
  }
  if (plan.operations.length === 0) {
    void window.api.sftp.discardPlan(plan.planId)
    toast.info(
      request.kind === 'move'
        ? translate('sftpPage.move.nothingToDo', 'Already in that folder.')
        : translate(
            'sftpPage.confirm.nothingToDo',
            'Nothing to transfer: no regular files or folders were selected.'
          )
    )
    return false
  }
  if (!(await context.confirm(sftpPlanConfirmOptions(plan, context.target)))) {
    void window.api.sftp.discardPlan(plan.planId)
    return false
  }
  if (request.kind === 'upload' || request.kind === 'download') {
    return executeTransfer(plan, request)
  }
  const result = await window.api.sftp.execute({
    planId: plan.planId,
    transferId: createBrowserUuid()
  })
  if (!result.ok) {
    toast.error(result.error.message)
  }
  return result.ok
}

export function cancelSftpTransfer(transferId: string): void {
  void window.api.sftp.cancel(transferId)
}
