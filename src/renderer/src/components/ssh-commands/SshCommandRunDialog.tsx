import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { CommandList } from '../command-confirm/CommandList'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import {
  expandSshCommandTemplate,
  syncSshCommandParams,
  type SshCommandExpansion
} from '../../../../shared/ssh-command-template'
import type { SshCommand, SshCommandParam } from '../../../../shared/ssh-command-types'
import { useRemoteSessionStore } from '../ssh-page/remote-session-store'
import {
  checkSshCommandTarget,
  typeSshCommand,
  sshCommandBlockMessage,
  sshCommandRemotePlatform,
  type SshCommandTargetCheck
} from './ssh-command-send'
import { initialSshCommandValues, rememberSshCommandValues } from './ssh-command-values'
import {
  doubtMessage,
  MultiTargetPreview,
  ParamField,
  problemMessage,
  TargetPicker,
  type SshCommandRunOption
} from './SshCommandRunFields'

export type { SshCommandRunOption }

export type SshCommandRunRequest = SshCommandRunOption & {
  command: SshCommand
  /** The rest of the grid this tab is in, where the command can also go. */
  otherTargets?: readonly SshCommandRunOption[]
}

const NO_OTHER_TARGETS: readonly SshCommandRunOption[] = []

const EMPTY_SELECTION: readonly string[] = []

function expandFor(
  option: SshCommandRunOption,
  command: SshCommand,
  params: readonly SshCommandParam[],
  values: Readonly<Record<string, string>>,
  isMultiTarget: boolean,
  files: { path: string | null; selected: readonly string[] }
): SshCommandExpansion {
  return expandSshCommandTemplate({
    template: command.template,
    params,
    values,
    builtins: {
      host: option.target.host,
      user: option.target.username,
      path: files.path,
      selected: files.selected
    },
    remotePlatform: sshCommandRemotePlatform(option.tabId, option.target.id),
    isMultiTarget
  })
}

function RunDialogBody({
  request,
  onClose
}: {
  request: SshCommandRunRequest
  onClose: () => void
}): React.JSX.Element {
  const { command, tabId, target, otherTargets = NO_OTHER_TARGETS } = request
  const remotePath = useRemoteSessionStore((s) => s.remotePathByTab[tabId] ?? null)
  const selected = useRemoteSessionStore((s) => s.remoteSelectionByTab[tabId] ?? EMPTY_SELECTION)
  const params = useMemo(() => {
    const { params: rows, unusedKeys } = syncSshCommandParams(command.template, command.params)
    return rows.filter((param) => !unusedKeys.includes(param.key))
  }, [command.params, command.template])
  const [values, setValues] = useState(() => initialSshCommandValues(command.id, params))
  const [checks, setChecks] = useState<Readonly<Record<string, SshCommandTargetCheck>>>({})
  // Why only this tab: reaching more hosts should take a deliberate tick each.
  const [chosenTabIds, setChosenTabIds] = useState<ReadonlySet<string>>(() => new Set([tabId]))
  const [isSending, setIsSending] = useState(false)
  const isClosedRef = useRef(false)
  useEffect(() => {
    isClosedRef.current = false
    return () => {
      isClosedRef.current = true
    }
  }, [])
  const options = useMemo<SshCommandRunOption[]>(
    () => [{ tabId, target }, ...otherTargets],
    [otherTargets, tabId, target]
  )

  useEffect(() => {
    let isCancelled = false
    void Promise.all(
      options.map(async (option) => [option.tabId, await checkSshCommandTarget(option.tabId)])
    ).then((entries) => {
      if (!isCancelled) {
        setChecks(Object.fromEntries(entries))
      }
    })
    return () => {
      isCancelled = true
    }
  }, [options])

  const chosen = options.filter((option) => chosenTabIds.has(option.tabId))
  const isMultiTarget = chosen.length > 1
  const expansions = chosen.map((option) => ({
    option,
    expansion: expandFor(option, command, params, values, isMultiTarget, {
      path: option.tabId === tabId ? remotePath : null,
      selected: option.tabId === tabId ? selected : EMPTY_SELECTION
    })
  }))
  const sendable = expansions.filter(({ option }) => checks[option.tabId]?.kind === 'ready')
  const problems = expansions
    .flatMap(({ expansion }) => expansion.problems)
    .filter(
      (problem, index, all) =>
        all.findIndex((other) => other.key === problem.key && other.kind === problem.kind) === index
    )
  const warnings = expansions
    .flatMap(({ expansion }) => expansion.warnings)
    .filter(
      (warning, index, all) =>
        all.findIndex((other) => other.key === warning.key && other.kind === warning.kind) === index
    )
  const isBlank = expansions.some(({ expansion }) => expansion.command.trim() === '')
  const canSend = sendable.length > 0 && problems.length === 0 && !isBlank && !isSending
  const labelOf = (key: string): string => params.find((param) => param.key === key)?.label || key
  const check = checks[tabId]
  const doubts = [
    ...new Set(
      chosen.flatMap((option) => {
        const chosenCheck = checks[option.tabId]
        return chosenCheck?.kind === 'ready' && chosenCheck.doubt ? [chosenCheck.doubt] : []
      })
    )
  ]

  const send = async (mode: 'run' | 'insert'): Promise<void> => {
    setIsSending(true)
    const missed: { host: string; reason: string }[] = expansions
      .filter(({ option }) => checks[option.tabId]?.kind !== 'ready')
      .map(({ option }) => ({
        host: option.target.label,
        reason: translate('sshCommands.run.skipped', 'Skipped')
      }))
    let sentCount = 0
    for (const { option, expansion } of sendable) {
      // Why: closing the dialog while sending means stop, not finish the rest of the hosts.
      if (isClosedRef.current) {
        return
      }
      const result = await typeSshCommand(option.tabId, expansion.command, mode)
      if (result.isSent) {
        sentCount += 1
      } else {
        missed.push({ host: option.target.label, reason: result.reason })
      }
    }
    for (const { host, reason } of missed) {
      toast.error(`${host}: ${reason}`)
    }
    if (sentCount === 0) {
      setIsSending(false)
      return
    }
    // Why the tab in use: typing elsewhere must not leave the keyboard on a pane not highlighted.
    focusTerminalTabSurface(tabId)
    rememberSshCommandValues(command.id, values)
    onClose()
  }

  const isRunFirst = command.runMode === 'run'
  return (
    <>
      <DialogHeader className="min-w-0">
        <DialogTitle>{command.name}</DialogTitle>
        <DialogDescription>
          {chosen.length === 1
            ? translate(
                'sshCommands.run.target',
                'Typed into this tab’s terminal, opened for {{host}}. If you connected onward from there, it runs wherever that shell is.',
                { host: chosen[0].target.label }
              )
            : translate(
                'sshCommands.run.targetMany',
                'Typed into each chosen tab’s terminal. If you connected onward from one, it runs wherever that shell is.'
              )}
        </DialogDescription>
      </DialogHeader>
      {params.length > 0 ? (
        <div className="scrollbar-sleek flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
          {params.map((param) => (
            <ParamField
              key={param.key}
              param={param}
              value={values[param.key] ?? ''}
              onChange={(value) => setValues({ ...values, [param.key]: value })}
            />
          ))}
        </div>
      ) : null}
      {otherTargets.length > 0 ? (
        <TargetPicker
          options={options}
          chosenTabIds={chosenTabIds}
          checks={checks}
          onToggle={(toggled, isChosen) => {
            const next = new Set(chosenTabIds)
            if (isChosen) {
              next.add(toggled)
            } else {
              next.delete(toggled)
            }
            setChosenTabIds(next)
          }}
        />
      ) : null}
      {/* Why always in a grid: the user may have unticked the tab in use, so name who gets it. */}
      {otherTargets.length > 0 ? (
        <MultiTargetPreview
          lines={expansions.map(({ option, expansion }) => ({
            tabId: option.tabId,
            host: option.target.label,
            command: expansion.command,
            isSkipped: checks[option.tabId]?.kind === 'blocked'
          }))}
        />
      ) : (
        <CommandList commands={expansions.map(({ expansion }) => expansion.command)} />
      )}
      {otherTargets.length === 0 && check?.kind === 'blocked' ? (
        <p data-ssh-command-blocked className="text-sm text-destructive">
          {sshCommandBlockMessage(check.reason)}
        </p>
      ) : null}
      {doubts.map((doubt) => (
        <p key={doubt} data-ssh-command-doubt={doubt} className="text-sm text-destructive">
          {doubtMessage(doubt)}
        </p>
      ))}
      {problems.map((problem) => (
        <p
          key={`${problem.kind}:${problem.key}`}
          data-ssh-command-problem={problem.kind}
          className="text-sm text-destructive"
        >
          {problemMessage(problem, labelOf)}
        </p>
      ))}
      {warnings
        .filter((warning) => warning.kind === 'leadingDash')
        .map((warning) => (
          <p key={warning.key} className="text-xs text-muted-foreground">
            {translate(
              'sshCommands.run.leadingDash',
              '“{{name}}” starts with a dash, so the program may read it as an option. Quotes can’t prevent that; put -- before it in the template if it’s a name.',
              { name: labelOf(warning.key) }
            )}
          </p>
        ))}
      <DialogFooter>
        <Button variant="outline" disabled={isSending} onClick={onClose}>
          {translate('sshCommands.run.cancel', 'Cancel')}
        </Button>
        <Button
          variant={isRunFirst ? 'outline' : 'default'}
          disabled={!canSend}
          data-ssh-command-insert
          onClick={() => void send('insert')}
        >
          {translate('sshCommands.run.insert', 'Paste without running')}
        </Button>
        <Button
          variant={isRunFirst ? 'default' : 'outline'}
          disabled={!canSend}
          data-ssh-command-run
          onClick={() => void send('run')}
        >
          {isMultiTarget
            ? translate('sshCommands.run.runOnMany', 'Run on {{count}} hosts', {
                count: sendable.length
              })
            : translate('sshCommands.run.run', 'Run')}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Fill in the values and see the exact command. This screen is also the confirmation. */
export function SshCommandRunDialog({
  request,
  onClose
}: {
  request: SshCommandRunRequest | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent surface="security" className="sm:max-w-2xl" data-ssh-command-run-dialog>
        {request ? (
          <RunDialogBody key={request.command.id} request={request} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
