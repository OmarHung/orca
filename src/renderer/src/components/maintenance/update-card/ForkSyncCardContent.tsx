import React from 'react'
import { AlertCircle, GitMerge, Minus, X } from 'lucide-react'
import { Button } from '../../ui/button'
import { Progress } from '../../ui/progress'
import { translate } from '@/i18n/i18n'
import { launchForkSyncConflictAgent } from '@/lib/fork-sync-conflict-agent'
import {
  FORK_SYNC_STAGES,
  type ForkSyncStage,
  type ForkSyncStatus
} from '../../../../../shared/fork-sync-status'

const MAX_LISTED_FILES = 6

function stageLabel(stage: ForkSyncStage): string {
  switch (stage) {
    case 'fetch':
      return translate('forkSync.stage.fetch', 'Fetching upstream')
    case 'rebase':
      return translate('forkSync.stage.rebase', 'Re-applying your changes')
    case 'install':
      return translate('forkSync.stage.install', 'Installing dependencies')
    case 'verify':
      return translate('forkSync.stage.verify', 'Typechecking and testing')
    case 'push':
      return translate('forkSync.stage.push', 'Pushing to your fork')
    case 'build':
      return translate('forkSync.stage.build', 'Building the app')
  }
}

function CardHeader({
  title,
  onClose,
  kind
}: {
  title: string
  onClose: () => void
  /** Minimize keeps a running or actionable update in the status bar; close dismisses it. */
  kind: 'minimize' | 'close'
}): React.JSX.Element {
  const closeLabel =
    kind === 'minimize'
      ? translate('forkSync.minimize', 'Minimize')
      : translate('forkSync.close', 'Close')
  return (
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Button
        variant="ghost"
        size="icon-xs"
        className="-m-1 shrink-0"
        onClick={onClose}
        aria-label={closeLabel}
      >
        {kind === 'minimize' ? <Minus /> : <X />}
      </Button>
    </div>
  )
}

function ConflictContent({
  forkSync,
  onRetry,
  onCollapse
}: {
  forkSync: Extract<ForkSyncStatus, { phase: 'conflict' }>
  onRetry: () => void
  onCollapse: () => void
}): React.JSX.Element {
  const listed = forkSync.files.slice(0, MAX_LISTED_FILES)
  const hidden = forkSync.files.length - listed.length
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="fork-sync-conflict">
      <CardHeader
        title={translate('forkSync.conflictTitle', 'Your changes conflict with {{value0}}', {
          value0: forkSync.targetTag
        })}
        kind="minimize"
        onClose={onCollapse}
      />
      <p className="text-xs text-muted-foreground">
        {forkSync.commitSubject
          ? translate(
              'forkSync.conflictCommit',
              '"{{value0}}" no longer applies cleanly. The branch was left unchanged.',
              { value0: forkSync.commitSubject }
            )
          : translate(
              'forkSync.conflictNoCommit',
              'A fork commit no longer applies cleanly. The branch was left unchanged.'
            )}
      </p>
      <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-foreground">
        {listed.map((file) => (
          <li key={file} className="truncate" title={file}>
            {file}
          </li>
        ))}
        {hidden > 0 ? (
          <li className="text-muted-foreground">
            {translate('forkSync.moreFiles', '+{{value0}} more', { value0: hidden })}
          </li>
        ) : null}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void launchForkSyncConflictAgent(forkSync)}>
          {translate('forkSync.resolveWithAgent', 'Resolve with AI')}
        </Button>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {translate('forkSync.retry', 'Retry')}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'forkSync.conflictHint',
          'Resolve in {{value0}} (by hand or with an agent), then press Retry to verify, push, and rebuild.',
          { value0: forkSync.repoRoot }
        )}
      </p>
    </div>
  )
}

export function ForkSyncCardContent({
  forkSync,
  onUpdate,
  onInstall,
  onDismiss,
  onCollapse
}: {
  forkSync: ForkSyncStatus
  onUpdate: () => void
  onInstall: () => void
  onDismiss: () => void
  onCollapse: () => void
}): React.JSX.Element {
  if (forkSync.phase === 'available') {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="fork-sync-available">
        <CardHeader
          title={translate('forkSync.availableTitle', 'Upstream released {{value0}}', {
            value0: forkSync.targetTag
          })}
          kind="close"
          onClose={onDismiss}
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'forkSync.availableBody',
            'This build is your fork on {{value0}}. Updating re-applies your changes on {{value1}}, verifies, pushes, and rebuilds. It takes about 10 minutes; you can keep working.',
            { value0: forkSync.baseTag, value1: forkSync.targetTag }
          )}
        </p>
        <Button size="sm" className="self-start" onClick={onUpdate}>
          <GitMerge />
          {translate('forkSync.syncAndUpdate', 'Sync & update')}
        </Button>
      </div>
    )
  }
  if (forkSync.phase === 'syncing') {
    const step = FORK_SYNC_STAGES.indexOf(forkSync.stage) + 1
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="fork-sync-progress">
        <CardHeader
          title={translate('forkSync.syncingTitle', 'Updating to {{value0}}', {
            value0: forkSync.targetTag
          })}
          kind="minimize"
          onClose={onCollapse}
        />
        <p className="text-xs text-muted-foreground">
          {translate('forkSync.stepOf', 'Step {{value0}} of {{value1}}: {{value2}}…', {
            value0: step,
            value1: FORK_SYNC_STAGES.length,
            value2: stageLabel(forkSync.stage)
          })}
        </p>
        <Progress value={(step / (FORK_SYNC_STAGES.length + 1)) * 100} />
      </div>
    )
  }
  if (forkSync.phase === 'built') {
    return (
      <div className="flex flex-col gap-3 p-4" data-testid="fork-sync-built">
        <CardHeader
          title={translate('forkSync.builtTitle', '{{value0}} is built', {
            value0: forkSync.targetTag
          })}
          kind="minimize"
          onClose={onCollapse}
        />
        <Button size="sm" className="self-start" onClick={onInstall}>
          {translate('forkSync.installRestart', 'Install and restart')}
        </Button>
      </div>
    )
  }
  if (forkSync.phase === 'conflict') {
    return <ConflictContent forkSync={forkSync} onRetry={onUpdate} onCollapse={onCollapse} />
  }
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="fork-sync-failed">
      <CardHeader
        title={translate('forkSync.failedTitle', 'Updating to {{value0}} failed', {
          value0: forkSync.targetTag
        })}
        kind="minimize"
        onClose={onCollapse}
      />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertCircle className="size-3.5 shrink-0 text-destructive" />
        {forkSync.stage
          ? translate('forkSync.failedAt', 'Stopped at: {{value0}}', {
              value0: stageLabel(forkSync.stage)
            })
          : translate('forkSync.failedStart', 'The sync could not start.')}
      </p>
      {forkSync.logTail ? (
        <pre className="max-h-40 overflow-auto scrollbar-sleek whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[10px] text-foreground select-text">
          {forkSync.logTail}
        </pre>
      ) : null}
      <Button size="sm" variant="outline" className="self-start" onClick={onUpdate}>
        {translate('forkSync.retry', 'Retry')}
      </Button>
    </div>
  )
}
