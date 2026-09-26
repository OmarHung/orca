import { Bug, Layers, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'

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
