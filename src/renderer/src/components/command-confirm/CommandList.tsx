import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

// Why: rendering tens of thousands of lines would stall the dialog; the copy holds all of them.
export const MAX_SHOWN_COMMANDS = 200

async function copyCommands(commands: readonly string[]): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(`${commands.join('\n')}\n`)
    toast.success(
      translate('commandConfirm.copied', 'Copied {{count}} lines', { count: commands.length })
    )
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

/** Numbered, wrapping command lines; a wrapped line stays visibly one command. */
export function CommandList({ commands }: { commands: readonly string[] }): React.JSX.Element {
  // Line numbers are the identity: the list is fixed once shown and never reorders.
  const lines = commands
    .slice(0, MAX_SHOWN_COMMANDS)
    .map((command, index) => ({ number: index + 1, command }))
  const hidden = commands.length - lines.length
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {translate('commandConfirm.count', '{{count}} commands, run top to bottom', {
            count: commands.length
          })}
        </span>
        <Button variant="ghost" size="xs" onClick={() => void copyCommands(commands)}>
          <Copy className="size-3" />
          {translate('commandConfirm.copy', 'Copy all')}
        </Button>
      </div>
      <ol
        tabIndex={0}
        aria-label={translate('commandConfirm.listLabel', 'Commands')}
        data-command-list
        className="scrollbar-sleek max-h-72 list-none overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-5 select-text"
      >
        {lines.map((line) => (
          <li key={line.number} className="flex gap-3">
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums select-none">
              {line.number}
            </span>
            <span className="min-w-0 break-all whitespace-pre-wrap">{line.command}</span>
          </li>
        ))}
      </ol>
      {hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'commandConfirm.truncated',
            'Showing the first {{shown}} of {{total}}. Use “Copy all” to review every line.',
            { shown: MAX_SHOWN_COMMANDS, total: commands.length }
          )}
        </p>
      ) : null}
    </div>
  )
}
