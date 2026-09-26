import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type { TerminalQuickCommandDialogAction } from './terminal-quick-command-dialog-draft'
import { QUICK_COMMAND_TOGGLE_ITEM_CLASS } from './terminal-quick-command-toggle-style'
import { translate } from '@/i18n/i18n'

export type QuickCommandDialogActionChoice = TerminalQuickCommandDialogAction | 'compound'

type TerminalQuickCommandActionToggleProps = {
  selectedAction: QuickCommandDialogActionChoice
  onActionChange: (action: QuickCommandDialogActionChoice) => void
  /** Only the Run widget offers compounds; they need a workspace to detect runs in. */
  showCompound?: boolean
}

export function TerminalQuickCommandActionToggle({
  selectedAction,
  onActionChange,
  showCompound = false
}: TerminalQuickCommandActionToggleProps): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      value={selectedAction}
      onValueChange={(value) => {
        if (
          value === 'terminal-command' ||
          value === 'agent-prompt' ||
          (showCompound && value === 'compound')
        ) {
          onActionChange(value)
        }
      }}
      // Why: equal columns keep the control width stable when labels differ by locale.
      className={cn('grid', showCompound ? 'w-[17.25rem] grid-cols-3' : 'w-[11.5rem] grid-cols-2')}
      variant="outline"
    >
      <ToggleGroupItem
        value="terminal-command"
        className={cn(QUICK_COMMAND_TOGGLE_ITEM_CLASS, 'w-full justify-center')}
        aria-label={translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandActionToggle.b5ea4d64f6',
          'Terminal Command'
        )}
      >
        {translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandActionToggle.terminal_short',
          'Terminal'
        )}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="agent-prompt"
        className={cn(QUICK_COMMAND_TOGGLE_ITEM_CLASS, 'w-full justify-center')}
        aria-label={translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandActionToggle.b0d58e37ed',
          'Agent Prompt'
        )}
      >
        {translate(
          'auto.components.terminal.quick.commands.TerminalQuickCommandActionToggle.agent_short',
          'Agent'
        )}
      </ToggleGroupItem>
      {showCompound ? (
        <ToggleGroupItem
          value="compound"
          data-testid="quick-command-action-compound"
          className={cn(QUICK_COMMAND_TOGGLE_ITEM_CLASS, 'w-full justify-center')}
          aria-label={translate('run.compound.actionLabel', 'Compound: start several runs')}
        >
          {translate('run.compound.actionShort', 'Compound')}
        </ToggleGroupItem>
      ) : null}
    </ToggleGroup>
  )
}
