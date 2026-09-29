import { ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'
import { translate } from '@/i18n/i18n'
import { formatBytes } from '../status-bar/workspace-space-format'
import { cancelSftpTransfer } from './sftp-plan-actions'
import { useSftpTransfersStore, type SftpTransfer } from './sftp-transfers-store'

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

function TransferRow({ transfer }: { transfer: SftpTransfer }): React.JSX.Element {
  const Icon = transfer.direction === 'upload' ? ArrowUpFromLine : ArrowDownToLine
  const percent =
    transfer.totalBytes > 0
      ? Math.round((transfer.transferredBytes / transfer.totalBytes) * 100)
      : 0
  const cancelLabel = translate('sftpPage.transfers.cancel', 'Cancel transfer')
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs" data-sftp-transfer={transfer.id}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
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

export function SftpTransfersPanel(): React.JSX.Element | null {
  const transfers = useSftpTransfersStore((s) => s.transfers)
  const clearFinished = useSftpTransfersStore((s) => s.clearFinished)
  if (transfers.length === 0) {
    return null
  }
  const hasFinished = transfers.some((transfer) => transfer.status !== 'running')
  return (
    <div className="flex max-h-48 shrink-0 flex-col border-t border-border">
      <div className="flex shrink-0 items-center justify-between px-3 py-1">
        <span className="text-xs font-medium text-muted-foreground">
          {translate('sftpPage.transfers.title', 'Transfers')}
        </span>
        {hasFinished ? (
          <Button variant="ghost" size="xs" onClick={clearFinished}>
            {translate('sftpPage.transfers.clear', 'Clear finished')}
          </Button>
        ) : null}
      </div>
      <div className="scrollbar-sleek min-h-0 overflow-y-auto">
        {transfers.map((transfer) => (
          <TransferRow key={transfer.id} transfer={transfer} />
        ))}
      </div>
    </div>
  )
}
