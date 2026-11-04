import { useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { hasSshCommandControlCharacter } from '../../../../shared/ssh-command-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { sshSyncSkipMessage } from './ssh-sync-skip-message'
import { sendLineToPanes } from './ssh-sync-send'
import { useSshSyncStore } from './ssh-sync-store'

function SyncLineInput({ labelOf }: { labelOf: (tabId: string) => string }): React.JSX.Element {
  const [line, setLine] = useState('')
  const label = translate('sshPage.sync.lineLabel', 'Line to send to every host')

  const send = async (): Promise<void> => {
    if (line.trim() === '' || hasSshCommandControlCharacter(line)) {
      return
    }
    setLine('')
    const results = await sendLineToPanes(line)
    for (const { tabId, decision } of results) {
      // Why name them: a line going to some hosts only must not look like it went to all.
      if (!decision.send && useSshSyncStore.getState().joinedTabIds.has(tabId)) {
        toast.error(`${labelOf(tabId)}: ${sshSyncSkipMessage(decision.reason)}`)
      }
    }
  }

  return (
    <Input
      value={line}
      spellCheck={false}
      variant="code"
      density="compact"
      aria-label={label}
      placeholder={label}
      data-remote-sync-line
      onChange={(event) => setLine(event.target.value)}
      onPaste={(event) => {
        // Why: a text box joins pasted lines into one, which would be a different command.
        if (/[\r\n]/.test(event.clipboardData.getData('text'))) {
          event.preventDefault()
          toast.error(
            translate(
              'sshPage.sync.linePasteRefused',
              'This box sends one line. Use a saved command for several.'
            )
          )
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !isImeOwnedKeyboardEvent(event)) {
          event.preventDefault()
          void send()
        }
      }}
    />
  )
}

/** Stays on top of the terminals while input is going to several hosts, naming each one. */
export function RemoteSyncBar({
  hostLabels,
  labelOf
}: {
  hostLabels: readonly string[]
  labelOf: (tabId: string) => string
}): React.JSX.Element {
  const mode = useSshSyncStore((s) => s.mode)
  const setMode = useSshSyncStore((s) => s.setMode)
  const stop = useSshSyncStore((s) => s.stop)
  return (
    <div
      role="status"
      data-remote-sync-bar
      className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)] px-3 py-1.5 text-xs"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium">
          {translate('sshPage.sync.barTitle', 'Input goes to {{count}} hosts: {{hosts}}', {
            count: hostLabels.length,
            hosts: hostLabels.join(', ')
          })}
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="xs"
          value={mode}
          aria-label={translate('sshPage.sync.modeLabel', 'How input is sent')}
          onValueChange={(value) => {
            if (value === 'keystroke' || value === 'line') {
              setMode(value)
            }
          }}
        >
          <ToggleGroupItem value="keystroke" data-remote-sync-mode="keystroke">
            {translate('sshPage.sync.modeKeystrokeShort', 'Every key')}
          </ToggleGroupItem>
          <ToggleGroupItem value="line" data-remote-sync-mode="line">
            {translate('sshPage.sync.modeLineShort', 'Whole line')}
          </ToggleGroupItem>
        </ToggleGroup>
        <Button size="xs" data-remote-sync-stop onClick={stop}>
          {translate('sshPage.sync.stop', 'Stop')}
        </Button>
      </div>
      {mode === 'line' ? <SyncLineInput labelOf={labelOf} /> : null}
    </div>
  )
}
