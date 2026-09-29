import { describe, expect, it } from 'vitest'
import {
  detectDotnetRunConfigurations,
  isDotnetProjectFile,
  readLaunchProfileDetails,
  readLaunchProfiles,
  readTargetFrameworks
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
    "Site": { "commandName": "Project", "applicationUrl": "http://localhost:5000" },
    "IIS Express": { "commandName": "IISExpress" },
    "Docker": { "commandName": "Docker" }
  }
}`

function detect(
  projectXml: string,
  overrides: Partial<Parameters<typeof detectDotnetRunConfigurations>[0]> = {}
) {
  return detectDotnetRunConfigurations({
    projectDir: '/w/WebApp',
    projectFileName: 'WebApp.csproj',
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
    expect(readLaunchProfiles(LAUNCH_SETTINGS)).toEqual(['Site'])
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
      ['build', 'Build', 'dotnet build WebApp.csproj'],
      ['run', 'Site', 'dotnet run --project WebApp.csproj --launch-profile Site'],
      [
        'publish',
        'Publish (FolderProfile)',
        'dotnet publish WebApp.csproj -p:PublishProfile=FolderProfile'
      ]
    ])
    expect(configurations[0]).toMatchObject({
      projectName: 'WebApp',
      projectDir: '/w/WebApp',
      projectFile: '/w/WebApp/WebApp.csproj'
    })
  })

  it('falls back to a plain Run and a Release publish without profiles', () => {
    expect(detect(CONSOLE).map((configuration) => configuration.command)).toEqual([
      'dotnet build WebApp.csproj',
      'dotnet run --project WebApp.csproj',
      'dotnet publish WebApp.csproj -c Release'
    ])
  })

  it('only builds a class library', () => {
    expect(detect(LIBRARY).map((configuration) => configuration.kind)).toEqual(['build'])
  })

  it('offers Test instead of Run for a test project', () => {
    expect(detect(TESTS).map((configuration) => configuration.command)).toEqual([
      'dotnet build WebApp.csproj',
      'dotnet test WebApp.csproj'
    ])
  })

  it('quotes profile names with spaces', () => {
    const configurations = detect(WEB_PROJECT, {
      launchSettingsText: '{"profiles":{"My App":{"commandName":"Project"}}}'
    })

    expect(configurations[1].command).toBe(
      'dotnet run --project WebApp.csproj --launch-profile "My App"'
    )
  })

  it('attaches a debug target to each run, naming the project file and profile', () => {
    const configurations = detect(WEB_PROJECT, { launchSettingsText: LAUNCH_SETTINGS })

    expect(configurations[1].debug).toEqual({
      kind: 'dotnet-project',
      projectFile: '/w/WebApp/WebApp.csproj',
      launchProfile: 'Site'
    })
    expect(configurations[0].debug).toBeUndefined()
  })
})

describe('readTargetFrameworks', () => {
  it('reads one or several frameworks and skips MSBuild properties', () => {
    expect(readTargetFrameworks('<TargetFramework>net8.0</TargetFramework>')).toEqual(['net8.0'])
    expect(
      readTargetFrameworks('<TargetFrameworks> net8.0;net9.0-windows ;$(Extra)</TargetFrameworks>')
    ).toEqual(['net8.0', 'net9.0-windows'])
    expect(readTargetFrameworks(LIBRARY)).toEqual([])
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
