import {
  Bug,
  FlaskConical,
  Hammer,
  Layers,
  Play,
  SquareTerminal,
  Upload,
  type LucideIcon
} from 'lucide-react'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunConfigurationKind } from '../../../../shared/run-configurations/run-configuration-types'

export const RUN_KIND_ICONS: Record<RunConfigurationKind, LucideIcon> = {
  build: Hammer,
  run: Play,
  test: FlaskConical,
  publish: Upload,
  other: Play
}

export function runConfigurationIcon(configuration: RunConfigurationDefinition): LucideIcon {
  switch (configuration.type) {
    case 'command':
      return SquareTerminal
    case 'debug':
      return Bug
    case 'compound':
      return Layers
  }
}
