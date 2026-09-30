import React from 'react'
import type { RunConfigurationEcosystem } from '../../../../shared/run-configurations/run-configuration-types'

const ECOSYSTEM_LABELS: Record<RunConfigurationEcosystem, string> = {
  node: 'Node',
  dotnet: '.NET',
  python: 'Python'
}

export function runEcosystemLabel(ecosystem: RunConfigurationEcosystem): string {
  return ECOSYSTEM_LABELS[ecosystem]
}

/** Which toolchain a detected project belongs to, as a small tag before its name. */
export function RunEcosystemBadge({
  ecosystem
}: {
  ecosystem: RunConfigurationEcosystem
}): React.JSX.Element {
  return (
    <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted-foreground">
      {runEcosystemLabel(ecosystem)}
    </span>
  )
}
