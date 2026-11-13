import { Radio, RadioTower, RotateCw, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { removeTabFromGrid } from './ssh-grid-actions'
import {
  canReconnectInPlace,
  useSshSessionLivenessPolling,
  useSshSessionLivenessStore
} from './ssh-session-liveness'
import { sshSyncSkipMessage } from './ssh-sync-skip-message'
import { useSshSyncStore } from './ssh-sync-store'
import { useSshSyncPaneStatus } from './use-ssh-sync'

function PaneIconButton({
  label,
  dataAttr,
  onClick,
  children
}: {
  label: string
  dataAttr: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          data-remote-grid-action={dataAttr}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Says whether this pane gets synced input, why not if it doesn't, and how to change that. */
function PaneSyncStatus({
  tabId,
  sourceTabId,
  onJoinSync
}: {
  tabId: string
  /** The pane in use, which is where keystrokes come from. */
  sourceTabId: string
  onJoinSync: (tabId: string) => void
}): React.JSX.Element | null {
  const status = useSshSyncPaneStatus(tabId, sourceTabId)
  const setExcluded = useSshSyncStore((s) => s.setExcluded)
  if (!status.isOn) {
    return null
  }
  const { decision } = status
  const reason = decision.send ? null : decision.reason
  const needsAgreeing = reason === 'notJoined' || reason === 'manualSsh'
  return (
    <>
      <span data-remote-sync-status={reason ?? 'sending'} className="shrink-0 truncate">
        {reason
          ? sshSyncSkipMessage(reason)
          : translate('sshPage.sync.statusSending', 'Gets input')}
      </span>
      {needsAgreeing ? (
        <PaneIconButton
          label={translate('sshPage.sync.joinButton', 'Add to synced input')}
          dataAttr="sync-join"
          onClick={() => onJoinSync(tabId)}
        >
          <RadioTower className="size-3.5" />
        </PaneIconButton>
      ) : (
        <PaneIconButton
          label={
            reason === 'excluded'
              ? translate('sshPage.sync.include', 'Include in synced input')
              : translate('sshPage.sync.exclude', 'Exclude from synced input')
          }
          dataAttr={reason === 'excluded' ? 'sync-include' : 'sync-exclude'}
          onClick={() => setExcluded(tabId, reason !== 'excluded')}
        >
          <Radio className="size-3.5" />
        </PaneIconButton>
      )}
    </>
  )
}

/** Names the host a pane is on, says when ssh ended there, and watches for that happening. */
export function RemoteGridPaneHeader({
  tabId,
  sourceTabId,
  ptyId,
  createdAt,
  label,
  isActive,
  isVisible,
  isRunning,
  target,
  onReconnect,
  onJoinSync
}: {
  tabId: string
  sourceTabId: string
  ptyId: string | null
  createdAt: number
  label: string
  isActive: boolean
  isVisible: boolean
  isRunning: boolean
  target: SshTarget | undefined
  onReconnect: (tabId: string, target: SshTarget) => void
  onJoinSync: (tabId: string) => void
}): React.JSX.Element {
  const isSyncOn = useSshSyncStore((s) => s.isOn)
  useSshSessionLivenessPolling(tabId, ptyId, isVisible && isRunning, createdAt, isSyncOn)
  const observation = useSshSessionLivenessStore((s) => s.byTab[tabId])
  const hasEnded = isRunning && observation?.liveness === 'ended'
  return (
    <div
      data-remote-grid-header
      data-ssh-liveness={isRunning ? observation?.liveness : undefined}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1 border-b border-border pr-1 pl-2 text-xs',
        isActive ? 'bg-accent text-accent-foreground' : 'bg-card text-muted-foreground',
        hasEnded && 'bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)] text-foreground'
      )}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {hasEnded ? (
        <span data-ssh-session-ended className="shrink-0 truncate">
          {translate('sshPage.grid.ended', 'Local shell')}
        </span>
      ) : null}
      {hasEnded && target && canReconnectInPlace(observation.foreground) ? (
        <PaneIconButton
          label={translate('sshPage.session.reconnect', 'Reconnect')}
          dataAttr="reconnect"
          onClick={() => onReconnect(tabId, target)}
        >
          <RotateCw className="size-3.5" />
        </PaneIconButton>
      ) : null}
      <PaneSyncStatus tabId={tabId} sourceTabId={sourceTabId} onJoinSync={onJoinSync} />
      <PaneIconButton
        label={translate('sshPage.grid.remove', 'Remove from grid. The connection stays open.')}
        dataAttr="remove"
        onClick={() => removeTabFromGrid(tabId, isActive)}
      >
        <X className="size-3.5" />
      </PaneIconButton>
    </div>
  )
}
