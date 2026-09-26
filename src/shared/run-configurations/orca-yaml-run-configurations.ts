import { parseDocument } from 'yaml'
import { isOrcaYamlTextWithinLimit, MAX_ORCA_YAML_ALIAS_COUNT } from '../orca-yaml-file-limit'
import {
  normalizeRunConfigurationDefinitions,
  type RunConfigurationDefinition,
  type RunConfigurationProblem
} from './run-configuration-definition'

export type OrcaYamlRunConfigurations = {
  configurations: RunConfigurationDefinition[]
  problems: RunConfigurationProblem[]
}

const EMPTY: OrcaYamlRunConfigurations = { configurations: [], problems: [] }

/** Shared run configurations from a repo's `orca.yaml` (`runConfigurations:`). */
export function parseOrcaYamlRunConfigurations(content: string): OrcaYamlRunConfigurations {
  if (!isOrcaYamlTextWithinLimit(content)) {
    return EMPTY
  }
  try {
    const document = parseDocument(content, {
      keepSourceTokens: false,
      logLevel: 'silent',
      prettyErrors: false,
      uniqueKeys: true
    })
    if (document.errors.length > 0) {
      return EMPTY
    }
    const root: unknown = document.toJS({ maxAliasCount: MAX_ORCA_YAML_ALIAS_COUNT })
    const list =
      typeof root === 'object' && root !== null
        ? Object.getOwnPropertyDescriptor(root, 'runConfigurations')?.value
        : undefined
    return normalizeRunConfigurationDefinitions(list)
  } catch {
    return EMPTY
  }
}

/**
 * The text a user approves before shared configurations may run. It covers every field that
 * changes what executes, so any edit to orca.yaml's configurations asks again.
 */
export function runConfigurationsTrustContent(
  configurations: readonly RunConfigurationDefinition[]
): string {
  return configurations
    .map(
      (configuration) =>
        `# runConfigurations.${configuration.id}\n${JSON.stringify(configuration, null, 2)}`
    )
    .join('\n\n')
}
