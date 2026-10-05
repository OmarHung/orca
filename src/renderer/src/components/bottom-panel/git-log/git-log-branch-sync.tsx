import React from 'react'
import { ArrowDown, ArrowUp, CloudOff, Unlink } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { GitHistoryBranch } from '../../../../../shared/git-history'

function syncDetail(branch: GitHistoryBranch, hasRemotes: boolean): string | null {
  if (!branch.upstream) {
    return hasRemotes
      ? translate(
          'bottomPanel.gitLog.sync.notPublished',
          'Not pushed to a remote (no upstream branch)'
        )
      : null
  }
  if (branch.upstreamGone) {
    return translate(
      'bottomPanel.gitLog.sync.upstreamGone',
      'Upstream branch deleted on the remote'
    )
  }
  const parts = [
    branch.ahead
      ? translate('bottomPanel.gitLog.sync.ahead', '{{count}} to push', { count: branch.ahead })
      : null,
    branch.behind
      ? translate('bottomPanel.gitLog.sync.behind', '{{count}} to pull', { count: branch.behind })
      : null
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Row tooltip: `feature → origin/feature · 2 to push`, or why it isn't on a remote. A repo with no
 * remote branches at all never says "not pushed": there is nowhere to push.
 */
export function describeGitLogBranch(branch: GitHistoryBranch, hasRemotes: boolean): string {
  const name = branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name
  const detail = branch.kind === 'local' ? syncDetail(branch, hasRemotes) : null
  return detail ? `${name} · ${detail}` : name
}

function Count({ icon: Icon, value }: { icon: typeof ArrowUp; value: number }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums">
      <Icon className="size-3" />
      {value}
    </span>
  )
}

/**
 * JetBrains-style push/pull state after a local branch name. Hidden from the accessible name; the
 * row's tooltip spells it out.
 */
export function GitLogBranchSyncBadge({
  branch,
  hasRemotes
}: {
  branch: GitHistoryBranch
  hasRemotes: boolean
}): React.JSX.Element | null {
  if (branch.kind !== 'local') {
    return null
  }
  const content = !branch.upstream ? (
    hasRemotes ? (
      <CloudOff className="size-3" />
    ) : null
  ) : branch.upstreamGone ? (
    <Unlink className="size-3" />
  ) : branch.ahead || branch.behind ? (
    <>
      {branch.ahead ? <Count icon={ArrowUp} value={branch.ahead} /> : null}
      {branch.behind ? <Count icon={ArrowDown} value={branch.behind} /> : null}
    </>
  ) : null
  if (!content) {
    return null
  }
  return (
    <span
      aria-hidden
      data-testid="git-log-branch-sync"
      className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
    >
      {content}
    </span>
  )
}
