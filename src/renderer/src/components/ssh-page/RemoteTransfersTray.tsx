import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, X } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'
import { translate } from '@/i18n/i18n'
import type { SshTarget } from '../../../../shared/ssh-types'
import { cancelSftpTransfer } from '../sftp-page/sftp-plan-actions'
import { useSftpTransfersStore, type SftpTransfer } from '../sftp-page/sftp-transfers-store'
import { formatBytes } from '../status-bar/workspace-space-format'

function statusText(transfer: SftpTransfer): string {
  switch (transfer.status) {
    case 'running':
      return transfer.totalBytes > 0
        ? `${formatBytes(transfer.transferredBytes)} / ${formatBytes(transfer.totalBytes)}`
        : translate('sftpPage.transfers.preparing', 'Preparing…')
    case 'done':
      return translate('sftpPage.transfers.done', 'Done')
    case 'cancelled':
      return translate('sftpPage.transfers.cancelled', 'Cancelled')
    case 'failed':
      return transfer.error ?? translate('sftpPage.transfers.failed', 'Failed')
  }
}

function TransferRow({
  transfer,
  hostLabel
}: {
  transfer: SftpTransfer
  /** Null once the host is gone from the list; the row still reports its transfer. */
  hostLabel: string | null
}): React.JSX.Element {
  const Icon = transfer.direction === 'upload' ? ArrowUpFromLine : ArrowDownToLine
  const percent =
    transfer.totalBytes > 0
      ? Math.round((transfer.transferredBytes / transfer.totalBytes) * 100)
      : 0
  const cancelLabel = translate('sftpPage.transfers.cancel', 'Cancel transfer')
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs" data-sftp-transfer={transfer.id}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {hostLabel ? (
        <Badge variant="outline" className="max-w-40 shrink-0">
          <span className="truncate">{hostLabel}</span>
        </Badge>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-foreground">{transfer.label}</span>
          <span className="truncate text-muted-foreground">→ {transfer.destinationDir}</span>
        </div>
        {transfer.status === 'running' ? <Progress value={percent} /> : null}
      </div>
      <span className="max-w-64 shrink-0 truncate text-muted-foreground tabular-nums">
        {statusText(transfer)}
      </span>
      {transfer.status === 'running' ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={cancelLabel}
          title={cancelLabel}
          onClick={() => cancelSftpTransfer(transfer.id)}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Every host's transfers, at the bottom of the page so they stay in view in any layout and after
 * their tab closes: a transfer runs in main and does not depend on the tab that started it.
 */
export function RemoteTransfersTray({
  targetsById
}: {
  targetsById: ReadonlyMap<string, SshTarget>
}): React.JSX.Element | null {
  const transfers = useSftpTransfersStore((s) => s.transfers)
  const clearFinished = useSftpTransfersStore((s) => s.clearFinished)
  const [isOpen, setIsOpen] = useState(true)
  if (transfers.length === 0) {
    return null
  }
  const runningCount = transfers.filter((transfer) => transfer.status === 'running').length
  const Chevron = isOpen ? ChevronDown : ChevronRight
  return (
    <div data-remote-transfers className="flex max-h-48 shrink-0 flex-col border-t border-border">
      <div className="flex h-7 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Chevron className="size-3" />
          {translate('sftpPage.transfers.title', 'Transfers')}
          {runningCount > 0 ? (
            <span className="font-normal">
              {translate('sftpPage.transfers.runningCount', '{{count}} running', {
                count: runningCount
              })}
            </span>
          ) : null}
        </button>
        {runningCount < transfers.length ? (
          <Button variant="ghost" size="xs" onClick={clearFinished}>
            {translate('sftpPage.transfers.clear', 'Clear finished')}
          </Button>
        ) : null}
      </div>
      {isOpen ? (
        <div className="scrollbar-sleek min-h-0 overflow-y-auto">
          {transfers.map((transfer) => (
            <TransferRow
              key={transfer.id}
              transfer={transfer}
              hostLabel={targetsById.get(transfer.targetId)?.label ?? null}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
