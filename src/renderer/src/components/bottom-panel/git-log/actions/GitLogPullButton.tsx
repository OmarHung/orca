import React from 'react'
import { ArrowDownToLine, ChevronDown, GitMerge, GitPullRequestArrow, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { GitPullStrategy } from '../../../../../../shared/git-branch-action/git-branch-action-types'
import type { GitLogPullSource } from '../git-log-pull-source'
import { currentLabel } from './git-log-action-feedback'
import { GitLogMenuLabel } from './GitLogMenuLabel'
import { useGitLogActions } from './git-log-actions-context'

/** Log toolbar Pull: brings the current branch's upstream in by rebase or merge. */
export function GitLogPullButton({
  source
}: {
  source: GitLogPullSource | null
}): React.JSX.Element | null {
  const actions = useGitLogActions()
  if (!actions) {
    return null
  }
  const label = source
    ? translate('bottomPanel.gitLog.actions.pullFrom', 'Pull from {{upstream}}', {
        upstream: source.upstream
      })
    : translate(
        'bottomPanel.gitLog.actions.pullNoUpstream',
        'The current branch has no upstream branch to pull from'
      )
  const names = { current: currentLabel(actions.currentBranchName) }
  const pull = (strategy: GitPullStrategy): void => {
    if (source) {
      actions.run({ kind: 'pull', ref: source.ref, strategy })
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={label}
          title={label}
          disabled={!source || actions.runningKind !== null}
          data-testid="git-log-pull"
        >
          {actions.runningKind === 'pull' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ArrowDownToLine />
          )}
          {translate('bottomPanel.gitLog.actions.pull', 'Pull')}
          {source?.behind ? (
            <span className="tabular-nums text-muted-foreground">{source.behind}</span>
          ) : null}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          <GitLogMenuLabel text={label} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => pull('rebase')}>
          <GitPullRequestArrow />
          <GitLogMenuLabel
            text={translate(
              'bottomPanel.gitLog.actions.pullRebase',
              'Pull into “{{current}}” Using Rebase',
              names
            )}
          />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pull('merge')}>
          <GitMerge />
          <GitLogMenuLabel
            text={translate(
              'bottomPanel.gitLog.actions.pullMerge',
              'Pull into “{{current}}” Using Merge',
              names
            )}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
