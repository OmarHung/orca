import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Label } from '../ui/label'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import {
  readTerminalTabCursorLine,
  readTerminalTabScreen
} from '../terminal-pane/terminal-pane-manager-registry'
import { isSshProcess, useSshSessionLivenessStore } from './ssh-session-liveness'
import { sshSyncSkipMessage } from './ssh-sync-skip-message'
import { useSshSyncStore, type SshSyncMode } from './ssh-sync-store'

export type RemoteSyncPane = { tabId: string; label: string; ptyId: string | null }

/** `join` adds one pane to sync already running; otherwise this starts it for the whole grid. */
export type RemoteSyncRequest = { panes: readonly RemoteSyncPane[]; isJoining: boolean }

type PaneState = 'loading' | 'ready' | 'manual' | 'notConnected' | 'split'

async function readPaneState(pane: RemoteSyncPane): Promise<PaneState> {
  const foreground = pane.ptyId
    ? await window.api.pty.getForegroundProcess(pane.ptyId).catch(() => null)
    : null
  if (foreground === null || !isSshProcess(foreground)) {
    return 'notConnected'
  }
  // Why: what is typed while split can't be followed, and it isn't clear which pane gets the keys.
  if (readTerminalTabScreen(pane.tabId)?.paneCount !== 1) {
    return 'split'
  }
  return useSshSessionLivenessStore.getState().byTab[pane.tabId]?.hasManualSsh ? 'manual' : 'ready'
}

function RemoteSyncDialogBody({
  request,
  onClose
}: {
  request: RemoteSyncRequest
  onClose: () => void
}): React.JSX.Element {
  const { panes, isJoining } = request
  const [states, setStates] = useState<Readonly<Record<string, PaneState>>>({})
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const [mode, setMode] = useState<SshSyncMode>('keystroke')
  // Why show it: text already on a host's line becomes part of what runs, and can't be detected.
  const [cursorLines] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      panes.map((pane) => [pane.tabId, readTerminalTabCursorLine(pane.tabId)?.trim() ?? ''])
    )
  )

  useEffect(() => {
    let isCancelled = false
    void Promise.all(
      panes.map(async (pane) => [pane.tabId, await readPaneState(pane)] as const)
    ).then((entries) => {
      if (isCancelled) {
        return
      }
      setStates(Object.fromEntries(entries))
      // Why not a hand-started ssh: it may be on another host, so it has to be ticked on purpose.
      setChosen(new Set(entries.filter(([, state]) => state === 'ready').map(([tabId]) => tabId)))
    })
    return () => {
      isCancelled = true
    }
  }, [panes])

  const needed = isJoining ? 1 : 2
  const start = (): void => {
    const store = useSshSyncStore.getState()
    if (isJoining) {
      store.join([...chosen])
    } else {
      store.start([...chosen], mode)
    }
    onClose()
  }

  return (
    <>
      <DialogHeader className="min-w-0">
        <DialogTitle>
          {isJoining
            ? translate('sshPage.sync.joinTitle', 'Add this host to synced input?')
            : translate('sshPage.sync.startTitle', 'Send input to several hosts?')}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'sshPage.sync.description',
            'What you type goes to every host ticked here at once. Each key is checked first, and a host goes without it if ssh isn’t in front.'
          )}
        </DialogDescription>
      </DialogHeader>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
        <li>
          {isJoining
            ? translate(
                'sshPage.sync.noteJoining',
                'It starts taking input once you press Ctrl+C in its pane, which also clears anything on its line.'
              )
            : translate(
                'sshPage.sync.noteExistingText',
                'Text already on a host’s line becomes part of what runs. Each host’s current line is shown below.'
              )}
        </li>
        <li>
          {translate(
            'sshPage.sync.noteStopped',
            'A host that misses a key stops taking input, Ctrl+C included, so it never runs a line with part missing. Press Ctrl+C in its pane to bring it back.'
          )}
        </li>
        <li>
          {translate(
            'sshPage.sync.notePrompts',
            'Password prompts are recognised by their wording, so an unusual one can still get your typing.'
          )}
        </li>
        <li>
          {translate(
            'sshPage.sync.noteOnward',
            'If you connected onward from a host, or ssh was restarted by hand, Orca may not be able to tell, and the keys follow you there.'
          )}
        </li>
        <li>{translate('sshPage.sync.noteMouse', 'Mouse actions stay in their own pane.')}</li>
      </ul>
      <div className="flex min-w-0 flex-col gap-1.5" data-remote-sync-hosts>
        {panes.map((pane) => {
          const state = states[pane.tabId] ?? 'loading'
          return (
            <div key={pane.tabId} className="flex min-w-0 flex-col">
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <Checkbox
                  data-remote-sync-host={pane.tabId}
                  checked={chosen.has(pane.tabId)}
                  disabled={state === 'loading' || state === 'notConnected' || state === 'split'}
                  onCheckedChange={(checked) => {
                    const next = new Set(chosen)
                    if (checked === true) {
                      next.add(pane.tabId)
                    } else {
                      next.delete(pane.tabId)
                    }
                    setChosen(next)
                  }}
                />
                <span className="min-w-0 truncate">{pane.label}</span>
                {state === 'notConnected' ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {translate('sshPage.sync.hostNotConnected', 'Not connected')}
                  </span>
                ) : null}
                {state === 'split' ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {sshSyncSkipMessage('splitTab')}
                  </span>
                ) : null}
                {state === 'manual' ? (
                  <span className="min-w-0 truncate text-xs text-destructive">
                    {translate(
                      'sshPage.sync.hostManual',
                      'ssh was started by hand, so this may be another host'
                    )}
                  </span>
                ) : null}
              </label>
              {cursorLines[pane.tabId] ? (
                <code className="min-w-0 truncate pl-6 font-mono text-xs text-muted-foreground">
                  {cursorLines[pane.tabId]}
                </code>
              ) : null}
            </div>
          )
        })}
      </div>
      {isJoining ? null : (
        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value === 'line' ? 'line' : 'keystroke')}
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="keystroke" id="remote-sync-keystroke" />
            <Label htmlFor="remote-sync-keystroke" variant="settings">
              {translate(
                'sshPage.sync.modeKeystroke',
                'Every key as you type. History and Tab can leave each host with a different line, and Enter runs what each one shows.'
              )}
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="line" id="remote-sync-line" />
            <Label htmlFor="remote-sync-line" variant="settings">
              {translate(
                'sshPage.sync.modeLine',
                'A whole line at a time, from a box under the terminals. For one-off commands on production.'
              )}
            </Label>
          </div>
        </RadioGroup>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {translate('sshPage.sync.cancel', 'Cancel')}
        </Button>
        <Button data-remote-sync-confirm disabled={chosen.size < needed} onClick={start}>
          {isJoining
            ? translate('sshPage.sync.joinConfirm', 'Add host')
            : translate('sshPage.sync.startConfirm', 'Send to {{count}} hosts', {
                count: chosen.size
              })}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Turning on synced input always asks: there is deliberately no shortcut for it. */
export function RemoteSyncDialog({
  request,
  onClose
}: {
  request: RemoteSyncRequest | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        surface="security"
        className="sm:max-w-xl"
        data-remote-sync-dialog
        // Why: Enter must not start sending to several hosts by accident.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {request ? <RemoteSyncDialogBody request={request} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}
