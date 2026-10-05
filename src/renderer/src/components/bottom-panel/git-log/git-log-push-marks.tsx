import React from 'react'
import { ArrowUp, Cloud } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

function MarkTooltip({
  label,
  testId,
  children
}: {
  label: string
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex shrink-0 text-muted-foreground"
          aria-label={label}
          data-testid={testId}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** After a local branch badge whose remote-tracking branch is on the same commit. */
export function GitLogRemoteAlsoHereMark({
  remoteName
}: {
  remoteName: string
}): React.JSX.Element {
  return (
    <MarkTooltip
      testId="git-log-remote-also-here"
      label={translate('bottomPanel.gitLog.push.remoteAlsoHere', '{{name}} is on this commit too', {
        name: remoteName
      })}
    >
      <Cloud className="size-3" />
    </MarkTooltip>
  )
}

/** Before the subject of a commit no remote-tracking branch contains yet. */
export function GitLogUnpushedMark(): React.JSX.Element {
  return (
    <MarkTooltip
      testId="git-log-unpushed"
      label={translate('bottomPanel.gitLog.push.unpushed', 'Not pushed to a remote yet')}
    >
      <ArrowUp className="size-3" />
    </MarkTooltip>
  )
}
