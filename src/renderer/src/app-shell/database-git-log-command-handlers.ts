import { useBottomPanelLayout } from '../components/bottom-panel/bottom-panel-layout-store'
import { toggleDatabasePage } from '../components/database/database-page-navigation'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import type { KeybindingActionId } from '../../../shared/keybindings'

type ClaimCommand = (actionId: KeybindingActionId, run: () => void) => boolean

export function createDatabaseAndGitLogCommandHandlers(
  claim: ClaimCommand,
  workspaceChromeActive: boolean
): [KeybindingActionId, () => boolean][] {
  return [
    [
      'databasePage.toggle',
      () => (isWebClientLocation() ? false : claim('databasePage.toggle', toggleDatabasePage))
    ],
    [
      'bottomPanel.gitLog.toggle',
      () =>
        workspaceChromeActive
          ? claim('bottomPanel.gitLog.toggle', () =>
              useBottomPanelLayout.getState().toggleTab('git-log')
            )
          : false
    ]
  ]
}
