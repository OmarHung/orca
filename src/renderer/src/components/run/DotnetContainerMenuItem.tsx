import React from 'react'
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useDotnetContainerStore } from './dotnet-container-store'

/** Turns on Orca's Docker container for .NET 5-and-older runs (see run-dotnet-launcher.ts). */
export function DotnetContainerMenuItem(): React.JSX.Element {
  const enabled = useDotnetContainerStore((state) => state.enabled)
  const setEnabled = useDotnetContainerStore((state) => state.setEnabled)
  return (
    <DropdownMenuCheckboxItem
      data-testid="run-widget-dotnet-container"
      checked={enabled}
      onCheckedChange={(checked) => setEnabled(checked === true)}
    >
      {translate('run.widget.dotnetContainer', 'Run .NET 5 and older in Docker')}
    </DropdownMenuCheckboxItem>
  )
}
