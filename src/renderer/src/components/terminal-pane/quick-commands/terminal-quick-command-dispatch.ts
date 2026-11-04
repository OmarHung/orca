import type { TerminalQuickCommand } from '../../../../../shared/terminal/quick-commands/terminal-quick-command-types'
import {
  buildTerminalQuickCommandInput,
  flattenTerminalQuickCommand,
  isTerminalAgentQuickCommand
} from '../../../../../shared/terminal/quick-commands/terminal-quick-commands'
import { recordTerminalUserInputForLeaf } from '../input/terminal-input-activity'
import type { PtyTransport } from '../pty-transport/pty-transport-types'
import { reportTerminalOtherInput } from '../terminal-pane-manager-registry'

type QuickCommandPane = {
  leafId: string
  terminal: {
    focus: () => void
  }
}

type QuickCommandTransport = Pick<PtyTransport, 'sendInput'> &
  Partial<Pick<PtyTransport, 'getPtyId'>>

export function sendTerminalQuickCommandToPane({
  command,
  pane,
  tabId,
  transport
}: {
  command: TerminalQuickCommand
  pane: QuickCommandPane
  tabId: string
  transport: QuickCommandTransport | null | undefined
}): boolean {
  if (isTerminalAgentQuickCommand(command)) {
    return false
  }
  if (!transport) {
    return false
  }

  const input = buildTerminalQuickCommandInput(flattenTerminalQuickCommand(command))
  const sent = transport.sendInput(input, 'driving')
  if (sent) {
    reportTerminalOtherInput(transport.getPtyId?.(), input)
    recordTerminalUserInputForLeaf(tabId, pane.leafId)
    pane.terminal.focus()
  }
  return sent
}
