import { describe, expect, it } from 'vitest'
import {
  dotnetPublishAsCommand,
  dotnetPublishCommand,
  newDotnetPublishConfiguration,
  type DotnetPublishRunConfiguration
} from './dotnet-publish-configuration'
import { normalizeRunConfigurationDefinitions } from './run-configuration-definition'
import { planRunConfiguration } from './run-configuration-plan'

function publish(
  overrides: Partial<DotnetPublishRunConfiguration> = {}
): DotnetPublishRunConfiguration {
  return {
    type: 'dotnet-publish',
    id: 'p',
    name: 'Publish Api to folder',
    projectFile: 'src/Api/Api.csproj',
    ...overrides
  }
}

describe('dotnetPublishCommand', () => {
  it('publishes in Release to the target location', () => {
    expect(dotnetPublishCommand(publish({ outputDir: 'out/My Api' }))).toBe(
      'dotnet publish src/Api/Api.csproj -c Release -o "out/My Api"'
    )
  })

  it('passes the runtime, deployment mode and file options', () => {
    const command = dotnetPublishCommand(
      publish({
        buildConfiguration: 'Debug',
        framework: 'net8.0',
        runtime: 'linux-x64',
        selfContained: true,
        singleFile: true,
        readyToRun: true,
        trimmed: true,
        extraArgs: '-p:Version=1.2.3'
      })
    )

    expect(command).toBe(
      'dotnet publish src/Api/Api.csproj -c Debug -f net8.0 -r linux-x64 --self-contained true ' +
        '-p:PublishSingleFile=true -p:PublishReadyToRun=true -p:PublishTrimmed=true -p:Version=1.2.3'
    )
  })

  it('drops options that need a runtime, and trimming unless self-contained', () => {
    expect(
      dotnetPublishCommand(publish({ selfContained: true, singleFile: true, readyToRun: true }))
    ).toBe('dotnet publish src/Api/Api.csproj -c Release')
    expect(dotnetPublishCommand(publish({ runtime: 'win-x64', trimmed: true }))).toBe(
      'dotnet publish src/Api/Api.csproj -c Release -r win-x64 --self-contained false'
    )
  })
})

describe('dotnetPublishAsCommand', () => {
  it('runs from the workspace root and keeps its Before launch steps', () => {
    expect(dotnetPublishAsCommand(publish({ beforeLaunch: ['Test'] }))).toEqual({
      type: 'command',
      id: 'p',
      name: 'Publish Api to folder',
      command: 'dotnet publish src/Api/Api.csproj -c Release',
      beforeLaunch: ['Test']
    })
  })

  it('lets the plan use a publish as a launch and as a Before launch step', () => {
    const all = [
      publish(),
      {
        type: 'command' as const,
        id: 'deploy',
        name: 'Deploy',
        command: 'rsync',
        beforeLaunch: ['p']
      }
    ]

    const result = planRunConfiguration(all, 'deploy')

    expect(result.ok && result.plan.beforeLaunch.map((step) => step.command)).toEqual([
      'dotnet publish src/Api/Api.csproj -c Release'
    ])
  })
})

describe('newDotnetPublishConfiguration', () => {
  it("targets the project's bin/Release/<tfm>/publish like Rider", () => {
    expect(
      newDotnetPublishConfiguration({
        id: 'p',
        projectName: 'Api',
        projectFile: 'src/Api/Api.csproj',
        projectDir: 'src/Api',
        targetFrameworks: ['net8.0']
      })
    ).toEqual({
      type: 'dotnet-publish',
      id: 'p',
      name: 'Publish Api to folder',
      projectFile: 'src/Api/Api.csproj',
      outputDir: 'src/Api/bin/Release/net8.0/publish',
      buildConfiguration: 'Release'
    })
  })

  it('picks the first framework of a multi-targeted project at the workspace root', () => {
    const created = newDotnetPublishConfiguration({
      id: 'p',
      projectName: 'Lib',
      projectFile: 'Lib.csproj',
      projectDir: '',
      targetFrameworks: ['net8.0', 'net9.0']
    })

    expect(created).toMatchObject({ outputDir: 'bin/Release/net8.0/publish', framework: 'net8.0' })
  })
})

describe('normalizing a dotnet-publish configuration', () => {
  it('keeps its settings and rejects names that would break the command line', () => {
    const { configurations, problems } = normalizeRunConfigurationDefinitions([
      {
        type: 'dotnet-publish',
        name: 'Ship',
        projectFile: 'Api.csproj',
        outputDir: ' out ',
        runtime: 'osx-arm64',
        selfContained: true,
        singleFile: 'yes'
      },
      { type: 'dotnet-publish', name: 'Bad runtime', projectFile: 'Api.csproj', runtime: 'x; rm' },
      { type: 'dotnet-publish', name: 'No project', projectFile: 'Api.sln' }
    ])

    expect(configurations).toEqual([
      {
        type: 'dotnet-publish',
        id: 'Ship',
        name: 'Ship',
        projectFile: 'Api.csproj',
        outputDir: 'out',
        runtime: 'osx-arm64',
        selfContained: true
      }
    ])
    expect(problems.map((problem) => problem.index)).toEqual([1, 2])
  })
})
