import React from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { BottomPanelTabStatusSegment } from './BottomPanelTabStatusSegment'

export function GitLogStatusSegment(): React.JSX.Element {
  const shortcut = useShortcutLabel('bottomPanel.gitLog.toggle')
  return (
    <BottomPanelTabStatusSegment
      tab="git-log"
      icon={GitCommitHorizontal}
      label={translate('bottomPanel.gitLog.toggleLabel', 'Git Log')}
      shortcut={shortcut}
      testId="git-log-status-toggle"
    />
  )
}
