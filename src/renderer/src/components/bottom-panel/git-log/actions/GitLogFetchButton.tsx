import React from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useGitLogActions } from './git-log-actions-context'

/** JetBrains' Log toolbar Fetch: updates every remote's branches. */
export function GitLogFetchButton(): React.JSX.Element | null {
  const actions = useGitLogActions()
  if (!actions) {
    return null
  }
  const label = translate('bottomPanel.gitLog.actions.fetchAll', 'Fetch all remotes')
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      disabled={actions.runningKind !== null}
      data-testid="git-log-fetch"
      onClick={() => actions.run({ kind: 'fetch' })}
    >
      {actions.runningKind === 'fetch' ? <Loader2 className="animate-spin" /> : <Download />}
    </Button>
  )
}
