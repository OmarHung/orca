import { useEffect, useMemo, useState } from 'react'
import { Download, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  expandSshCommandTemplate,
  syncSshCommandParams
} from '../../../../shared/ssh-command-template'
import type { SshCommand } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useCommandConfirm } from '../command-confirm/command-confirm-context'
import { remoteSessionForTab, useRemoteSessionStore } from '../ssh-page/remote-session-store'
import { useSshHostGroups } from '../ssh-page/ssh-host-groups-store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { quickCommandsToSshDrafts } from './ssh-command-draft'
import { sshCommandAppliesToTarget } from './ssh-command-scope'
import {
  checkSshCommandTarget,
  sendSshCommand,
  sshCommandBuiltins,
  sshCommandRemotePlatform
} from './ssh-command-send'
import { forgetSshCommandValues } from './ssh-command-values'
import { useSshCommandsStore } from './ssh-commands-store'
import { SshCommandEditDialog, type SshCommandEditRequest } from './SshCommandEditDialog'
import {
  SshCommandRunDialog,
  type SshCommandRunOption,
  type SshCommandRunRequest
} from './SshCommandRunDialog'

function HeaderButton({
  label,
  dataAttr,
  onClick,
  children
}: {
  label: string
  dataAttr: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          aria-label={label}
          data-ssh-command-action={dataAttr}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function CommandRow({
  command,
  isOffered,
  onChoose,
  onEdit,
  onDelete
}: {
  command: SshCommand
  /** False when the command's scope leaves out this tab's host. It can still be edited. */
  isOffered: boolean
  onChoose: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div
      data-ssh-command-row={command.id}
      className="group relative flex min-w-0 items-center rounded-md hover:bg-accent focus-within:bg-accent"
    >
      <button
        type="button"
        disabled={!isOffered}
        onClick={onChoose}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left disabled:cursor-default disabled:opacity-60"
      >
        <span className="truncate text-xs font-medium">{command.name}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {command.template}
        </span>
      </button>
      <div className="absolute right-1 hidden items-center gap-0.5 rounded-md bg-accent group-focus-within:flex group-hover:flex">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('sshCommands.list.edit', 'Edit command')}
          data-ssh-command-edit
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('sshCommands.list.delete', 'Delete command')}
          data-ssh-command-delete
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function matchesQuery(command: SshCommand, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    needle === '' ||
    command.name.toLowerCase().includes(needle) ||
    command.template.toLowerCase().includes(needle)
  )
}

/** The saved commands, with those offered on the current tab's host first. */
export function SshCommandList({
  activeTabId,
  activeTarget,
  targets
}: {
  activeTabId: string | null
  activeTarget: SshTarget | null
  targets: readonly SshTarget[]
}): React.JSX.Element {
  const commands = useSshCommandsStore((s) => s.commands)
  const status = useSshCommandsStore((s) => s.status)
  const loadError = useSshCommandsStore((s) => s.error)
  const load = useSshCommandsStore((s) => s.load)
  const save = useSshCommandsStore((s) => s.save)
  const remove = useSshCommandsStore((s) => s.remove)
  const groups = useSshHostGroups((state) => state.data)
  const quickCommands = useAppStore((s) => s.settings?.terminalQuickCommands)
  const confirm = useCommandConfirm()
  const [query, setQuery] = useState('')
  const [editRequest, setEditRequest] = useState<SshCommandEditRequest | null>(null)
  const [runRequest, setRunRequest] = useState<SshCommandRunRequest | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const { offered, others } = useMemo(() => {
    const matching = commands.filter((command) => matchesQuery(command, query))
    const isOffered = (command: SshCommand): boolean =>
      !activeTarget || sshCommandAppliesToTarget(command.scope, activeTarget.id, groups)
    return {
      offered: matching.filter((command) => isOffered(command)),
      others: matching.filter((command) => !isOffered(command))
    }
  }, [activeTarget, commands, groups, query])

  const targetsById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets]
  )

  const importDrafts = useMemo(
    () => quickCommandsToSshDrafts(quickCommands ?? [], commands),
    [commands, quickCommands]
  )

  /** The rest of the grid on screen, limited to hosts this command is offered on. */
  const gridTargets = (command: SshCommand): SshCommandRunOption[] => {
    const { grid, sessions } = useRemoteSessionStore.getState()
    if (!activeTabId || !grid?.tabIds.includes(activeTabId)) {
      return []
    }
    return grid.tabIds.flatMap((tabId) => {
      const target = targetsById.get(remoteSessionForTab(sessions, tabId).targetId)
      const isOffered = target && sshCommandAppliesToTarget(command.scope, target.id, groups)
      return tabId !== activeTabId && isOffered ? [{ tabId, target }] : []
    })
  }

  const choose = async (command: SshCommand): Promise<void> => {
    if (!activeTabId || !activeTarget) {
      toast.info(translate('sshCommands.list.noTab', 'Open a tab on a host first.'))
      return
    }
    const otherTargets = gridTargets(command)
    const request = { command, tabId: activeTabId, target: activeTarget, otherTargets }
    const { params, unusedKeys } = syncSshCommandParams(command.template, command.params)
    const hasFields = params.some((param) => !unusedKeys.includes(param.key))
    // Why: in a grid the dialog is also where other hosts can be chosen.
    if (command.runMode !== 'insert' || hasFields || otherTargets.length > 0) {
      setRunRequest(request)
      return
    }
    const expansion = expandSshCommandTemplate({
      template: command.template,
      params: [],
      values: {},
      builtins: sshCommandBuiltins(activeTabId, activeTarget),
      remotePlatform: sshCommandRemotePlatform(activeTabId, activeTarget.id)
    })
    const check = await checkSshCommandTarget(activeTabId)
    // Why: only with nothing to fill in, no Enter pressed and nothing in doubt can it skip the dialog.
    if (expansion.problems.length > 0 || (check.kind === 'ready' && check.doubt)) {
      setRunRequest(request)
      return
    }
    void sendSshCommand(activeTabId, expansion.command, 'insert')
  }

  const deleteCommand = async (command: SshCommand): Promise<void> => {
    const isConfirmed = await confirm({
      title: translate('sshCommands.list.deleteTitle', 'Delete “{{name}}”?', {
        name: command.name
      }),
      commands: [command.template],
      isDestructive: true,
      confirmLabel: translate('sshCommands.list.deleteConfirm', 'Delete')
    })
    if (!isConfirmed) {
      return
    }
    try {
      await remove(command.id)
      forgetSshCommandValues(command.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const importQuickCommands = async (): Promise<void> => {
    try {
      for (const draft of importDrafts) {
        await save(undefined, draft)
      }
      toast.success(
        translate('sshCommands.list.imported', 'Imported {{count}} commands', {
          count: importDrafts.length
        })
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const renderRow = (command: SshCommand, isOffered: boolean): React.JSX.Element => (
    <CommandRow
      key={command.id}
      command={command}
      isOffered={isOffered}
      onChoose={() => void choose(command)}
      onEdit={() => setEditRequest({ command })}
      onDelete={() => void deleteCommand(command)}
    />
  )

  return (
    <div data-ssh-command-list className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            spellCheck={false}
            placeholder={translate('sshCommands.list.search', 'Search commands')}
            variant="search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {importDrafts.length > 0 ? (
          <HeaderButton
            label={translate('sshCommands.list.import', 'Import from Quick Commands')}
            dataAttr="import"
            onClick={() => void importQuickCommands()}
          >
            <Download className="size-3.5" />
          </HeaderButton>
        ) : null}
        <HeaderButton
          label={translate('sshCommands.list.new', 'New command')}
          dataAttr="new"
          onClick={() => setEditRequest({ command: null })}
        >
          <Plus className="size-3.5" />
        </HeaderButton>
      </div>
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
        {status === 'error' ? (
          <p className="px-3 py-4 text-xs break-words text-destructive">{loadError}</p>
        ) : null}
        {status === 'ready' && commands.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {translate(
              'sshCommands.list.empty',
              'No commands yet. Add one with a value to fill in, like journalctl -u {{service}}.',
              { service: '{{service}}' }
            )}
          </p>
        ) : null}
        {offered.map((command) => renderRow(command, true))}
        {others.length > 0 ? (
          <>
            <p className="px-2 pt-3 pb-1 text-xs text-muted-foreground">
              {translate('sshCommands.list.others', 'For other hosts')}
            </p>
            {others.map((command) => renderRow(command, false))}
          </>
        ) : null}
      </div>
      <SshCommandEditDialog
        request={editRequest}
        targets={targets}
        onClose={() => setEditRequest(null)}
      />
      <SshCommandRunDialog request={runRequest} onClose={() => setRunRequest(null)} />
    </div>
  )
}
