import { describe, expect, it } from 'vitest'
import {
  detectDotnetRunConfigurations,
  isDotnetProjectFile,
  readLaunchProfileDetails,
  readLaunchProfiles
} from './dotnet-run-configurations'

const WEB_PROJECT = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup /></Project>'
const LIBRARY = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup /></Project>'
const CONSOLE =
  '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>'
const TESTS =
  '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>'

const LAUNCH_SETTINGS = `{
  // Rider and VS keep comments here
  "profiles": {
    "MvcWeb": { "commandName": "Project", "applicationUrl": "http://localhost:5000" },
    "IIS Express": { "commandName": "IISExpress" },
    "Docker": { "commandName": "Docker" }
  }
}`

function detect(
  projectXml: string,
  overrides: Partial<Parameters<typeof detectDotnetRunConfigurations>[0]> = {}
) {
  return detectDotnetRunConfigurations({
    projectDir: '/w/Project2',
    projectFileName: 'Project2.csproj',
    projectXml,
    launchSettingsText: null,
    publishProfileNames: [],
    ...overrides
  })
}

describe('isDotnetProjectFile', () => {
  it('recognizes C#, F# and VB project files', () => {
    expect(isDotnetProjectFile('App.csproj')).toBe(true)
    expect(isDotnetProjectFile('App.FSPROJ')).toBe(true)
    expect(isDotnetProjectFile('App.sln')).toBe(false)
  })
})

describe('readLaunchProfiles', () => {
  it('keeps only profiles dotnet run can launch, and tolerates comments', () => {
    expect(readLaunchProfiles(LAUNCH_SETTINGS)).toEqual(['MvcWeb'])
    expect(readLaunchProfiles(null)).toEqual([])
    expect(readLaunchProfiles('not json')).toEqual([])
  })
})

describe('detectDotnetRunConfigurations', () => {
  it('offers Build, a Run per launch profile, and Publish per publish profile for a web app', () => {
    const configurations = detect(WEB_PROJECT, {
      launchSettingsText: LAUNCH_SETTINGS,
      publishProfileNames: ['FolderProfile']
    })

    expect(
      configurations.map((configuration) => [
        configuration.kind,
        configuration.name,
        configuration.command
      ])
    ).toEqual([
      ['build', 'Build', 'dotnet build Project2.csproj'],
      ['run', 'MvcWeb', 'dotnet run --project Project2.csproj --launch-profile MvcWeb'],
      [
        'publish',
        'Publish (FolderProfile)',
        'dotnet publish Project2.csproj -p:PublishProfile=FolderProfile'
      ]
    ])
    expect(configurations[0]).toMatchObject({ projectName: 'Project2', projectDir: '/w/Project2' })
  })

  it('falls back to a plain Run and a Release publish without profiles', () => {
    expect(detect(CONSOLE).map((configuration) => configuration.command)).toEqual([
      'dotnet build Project2.csproj',
      'dotnet run --project Project2.csproj',
      'dotnet publish Project2.csproj -c Release'
    ])
  })

  it('only builds a class library', () => {
    expect(detect(LIBRARY).map((configuration) => configuration.kind)).toEqual(['build'])
  })

  it('offers Test instead of Run for a test project', () => {
    expect(detect(TESTS).map((configuration) => configuration.command)).toEqual([
      'dotnet build Project2.csproj',
      'dotnet test Project2.csproj'
    ])
  })

  it('quotes profile names with spaces', () => {
    const configurations = detect(WEB_PROJECT, {
      launchSettingsText: '{"profiles":{"My App":{"commandName":"Project"}}}'
    })

    expect(configurations[1].command).toBe(
      'dotnet run --project Project2.csproj --launch-profile "My App"'
    )
  })

  it('attaches a debug target to each run, naming the project file and profile', () => {
    const configurations = detect(WEB_PROJECT, { launchSettingsText: LAUNCH_SETTINGS })

    expect(configurations[1].debug).toEqual({
      kind: 'dotnet-project',
      projectFile: '/w/Project2/Project2.csproj',
      launchProfile: 'MvcWeb'
    })
    expect(configurations[0].debug).toBeUndefined()
  })
})

describe('readLaunchProfileDetails', () => {
  it('reads the environment, URLs and arguments dotnet run would apply', () => {
    const text = `{
      "profiles": {
        "Api": {
          "commandName": "Project",
          "commandLineArgs": "--seed demo",
          "applicationUrl": "https://localhost:7001;http://localhost:5001",
          "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development", "N": 1 }
        }
      }
    }`

    expect(readLaunchProfileDetails(text, 'Api')).toEqual({
      environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
      applicationUrl: 'https://localhost:7001;http://localhost:5001',
      commandLineArgs: '--seed demo'
    })
    expect(readLaunchProfileDetails(text, 'Missing')).toBeNull()
    expect(readLaunchProfileDetails(null, 'Api')).toBeNull()
  })
})
