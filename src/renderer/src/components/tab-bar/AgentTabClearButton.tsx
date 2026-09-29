import { useContext, useEffect, useRef } from 'react'
import { Eraser } from 'lucide-react'
import { toast } from 'sonner'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { clearAgentTabConversation, resolveAgentTabClearTarget } from './agent-tab-clear'

type AgentTabClearButtonProps = {
  tabId: string
  tabTitle: string
  agent: TuiAgent
  isActive: boolean
  /** Mid-turn or on a prompt, where the submit Enter could answer the prompt instead. */
  isBusy: boolean
}

export function AgentTabClearButton({
  tabId,
  tabTitle,
  agent,
  isActive,
  isBusy
}: AgentTabClearButtonProps): React.JSX.Element | null {
  // Why: clearing must never skip confirmation, so without a dialog host there is no button.
  const confirm = useContext(ConfirmationDialogContext)
  // Why: the agent can exit (unmounting this button) or change while the dialog is open.
  const isMountedRef = useRef(true)
  const agentRef = useRef(agent)
  agentRef.current = agent
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])
  const label = isBusy
    ? translate('agentTabClear.busy', 'Wait for the agent to finish before clearing')
    : translate('agentTabClear.button', 'Clear conversation')

  if (!confirm) {
    return null
  }

  const clearConversation = async (): Promise<void> => {
    if (isBusy) {
      return
    }
    const ptyId = resolveAgentTabClearTarget(tabId)
    if (!ptyId) {
      toast.error(translate('agentTabClear.noTerminal', 'This tab has no running agent to clear.'))
      return
    }
    const confirmed = await confirm({
      title: translate('agentTabClear.confirmTitle', 'Clear this conversation?'),
      description: translate(
        'agentTabClear.confirmDescription',
        'Sends /clear to {{agent}} in “{{title}}”. The agent starts over without the current conversation’s context.',
        { agent: getAgentLabel(agent), title: tabTitle }
      ),
      confirmLabel: translate('agentTabClear.confirm', 'Clear'),
      confirmVariant: 'destructive',
      icon: Eraser
    })
    if (!confirmed) {
      return
    }
    const outcome =
      isMountedRef.current && agentRef.current === agent
        ? clearAgentTabConversation(tabId, agent, ptyId)
        : 'changed'
    if (outcome === 'busy') {
      toast.error(translate('agentTabClear.busy', 'Wait for the agent to finish before clearing'))
    } else if (outcome === 'changed') {
      toast.error(
        translate(
          'agentTabClear.changed',
          'The agent in this tab changed while you were confirming, so nothing was cleared.'
        )
      )
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // Why: aria-disabled instead of disabled keeps the tooltip explaining why it is unavailable.
          aria-disabled={isBusy}
          aria-label={translate('agentTabClear.ariaLabel', 'Clear conversation in {{title}}', {
            title: tabTitle
          })}
          data-tab-clear-button="true"
          className={cn(
            'relative z-10 mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm',
            isActive
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:text-foreground focus-visible:bg-muted'
              : 'text-transparent group-hover:text-muted-foreground hover:!text-foreground hover:!bg-muted focus-visible:!text-foreground focus-visible:!bg-muted',
            isBusy && 'cursor-default opacity-50'
          )}
          onPointerDown={(e) => {
            if (e.button === 0) {
              e.stopPropagation()
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.stopPropagation()
            }
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void clearConversation()
          }}
          // Why: a double click would otherwise open the tab's rename input behind the dialog.
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Eraser className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
