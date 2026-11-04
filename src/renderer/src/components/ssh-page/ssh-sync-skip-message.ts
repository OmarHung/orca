import { translate } from '@/i18n/i18n'
import type { SshSyncSkipReason } from './ssh-sync-decision'

/** Why a pane isn't getting input, short enough for its title. */
export function sshSyncSkipMessage(reason: SshSyncSkipReason): string {
  switch (reason) {
    case 'notOnScreen':
      return translate('sshPage.sync.skipNotOnScreen', 'Not on screen')
    case 'notJoined':
      return translate('sshPage.sync.skipNotJoined', 'Not in sync')
    case 'excluded':
      return translate('sshPage.sync.skipExcluded', 'Excluded')
    case 'splitTab':
      return translate('sshPage.sync.skipSplit', 'Paused: tab is split')
    case 'notSsh':
      return translate('sshPage.sync.skipNotSsh', 'Paused: no ssh running')
    case 'manualSsh':
      return translate('sshPage.sync.skipManual', 'Paused: may be another host')
    case 'fullScreenMismatch':
      return translate('sshPage.sync.skipFullScreen', 'Paused: screen differs')
    case 'passwordPrompt':
      return translate('sshPage.sync.skipPassword', 'Paused: answer this prompt here')
    case 'outOfStep':
      return translate('sshPage.sync.skipOutOfStep', 'Stopped: press Ctrl+C here to rejoin')
    case 'waitingForLine':
      return translate('sshPage.sync.skipWaiting', 'Stopped: other panes are mid-line')
    case 'sourcePaused':
      return translate('sshPage.sync.skipSourcePaused', 'Paused: the pane in use isn’t sending')
    case 'writeFailed':
      return translate('sshPage.sync.skipWriteFailed', 'Couldn’t type into this host')
  }
}
