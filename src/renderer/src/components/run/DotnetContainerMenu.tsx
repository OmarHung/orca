import React from 'react'
import { ChevronLeft, Container, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { DotnetContainerStatus } from '../../../../shared/dotnet-container-types'
import { useDotnetContainerStore } from './dotnet-container-store'
import { openDotnetContainerShell } from './run-dotnet-launcher'

function statusText(status: DotnetContainerStatus | null): string {
  if (!status) {
    return translate('run.widget.dotnetContainerChecking', 'Checking…')
  }
  if (status.docker !== 'running') {
    return status.docker === 'missing'
      ? translate('run.widget.dotnetContainerDockerMissing', 'Docker is not installed')
      : translate('run.widget.dotnetContainerDockerStopped', 'Docker is not running')
  }
  switch (status.container) {
    case 'none':
      return translate('run.widget.dotnetContainerNone', 'Container is created on the next run')
    case 'stopped':
      return translate('run.widget.dotnetContainerStopped', 'Container is stopped')
    case 'running':
      return translate('run.widget.dotnetContainerRunning', 'Container is running')
  }
}

function reportFailure(action: Promise<unknown>): void {
  void action.catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : String(error))
  })
}

/** The Run menu's controls for Orca's .NET 5-and-older Docker container. */
export function DotnetContainerMenu({
  worktreeId,
  groupId,
  cascadeLeft
}: {
  worktreeId: string
  groupId: string | null
  cascadeLeft: boolean
}): React.JSX.Element {
  const enabled = useAppStore((state) => state.settings?.dotnetContainerToolchain === true)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [status, setStatus] = React.useState<DotnetContainerStatus | null>(null)
  const refresh = (): void => {
    setStatus(null)
    void window.api.dotnetContainer
      .status()
      .then(setStatus)
      .catch(() => setStatus({ docker: 'stopped', container: 'none' }))
  }
  const setEnabled = async (checked: boolean): Promise<void> => {
    await updateSettings({ dotnetContainerToolchain: checked })
    if (checked) {
      // Why: new terminals put the launcher on PATH only once its file exists.
      await useDotnetContainerStore.getState().loadLauncherPath()
    }
  }
  const openShell = async (): Promise<void> => {
    if (!(await openDotnetContainerShell(worktreeId, groupId))) {
      toast.error(
        translate(
          'run.widget.dotnetContainerShellUnavailable',
          'The .NET container only runs local workspaces on macOS and Linux'
        )
      )
    }
  }
  return (
    <DropdownMenuSub onOpenChange={(open) => open && refresh()}>
      <DropdownMenuSubTrigger data-testid="run-widget-dotnet-container" hideChevron={cascadeLeft}>
        <Container />
        {translate('run.widget.dotnetContainerMenu', '.NET Container')}
        {cascadeLeft ? <ChevronLeft className="ml-auto size-4" /> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuCheckboxItem
          checked={enabled}
          onCheckedChange={(checked) => reportFailure(setEnabled(checked === true))}
        >
          {translate('run.widget.dotnetContainer', 'Run .NET 5 and older in Docker')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuLabel>{statusText(status)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!enabled} onSelect={() => reportFailure(openShell())}>
          <SquareTerminal />
          {translate('run.widget.dotnetContainerShell', 'Open Terminal in Container')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={status?.container !== 'running'}
          onSelect={() => reportFailure(window.api.dotnetContainer.stop())}
        >
          <Square />
          {translate('run.widget.dotnetContainerStop', 'Stop Container')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={status?.docker !== 'running'}
          onSelect={() => reportFailure(window.api.dotnetContainer.reset())}
        >
          <Trash2 />
          {translate('run.widget.dotnetContainerReset', 'Remove Container and Image')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
