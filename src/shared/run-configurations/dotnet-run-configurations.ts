import { parse as parseJsonc } from 'jsonc-parser'
import { quoteShellArgument, type DetectedRunConfiguration } from './run-configuration-types'

export const DOTNET_PROJECT_EXTENSIONS = ['.csproj', '.fsproj', '.vbproj']

const RUNNABLE_SDK = /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.(Web|Worker|BlazorWebAssembly|Razor)/i
const EXE_OUTPUT = /<OutputType>\s*(Exe|WinExe)\s*<\/OutputType>/i
const TEST_PROJECT = /Microsoft\.NET\.Test\.Sdk|<IsTestProject>\s*true\s*<\/IsTestProject>/i

export function isDotnetProjectFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return DOTNET_PROJECT_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** `dotnet run` profiles; only `Project` profiles launch the app itself (not IIS/Docker). */
export function readLaunchProfiles(launchSettingsText: string | null): string[] {
  if (!launchSettingsText) {
    return []
  }
  const value: unknown = parseJsonc(launchSettingsText)
  if (typeof value !== 'object' || value === null) {
    return []
  }
  const profiles: unknown = Object.getOwnPropertyDescriptor(value, 'profiles')?.value
  if (typeof profiles !== 'object' || profiles === null) {
    return []
  }
  return Object.entries(profiles).flatMap(([name, profile]) => {
    const commandName: unknown =
      typeof profile === 'object' && profile !== null
        ? Object.getOwnPropertyDescriptor(profile, 'commandName')?.value
        : undefined
    return commandName === 'Project' ? [name] : []
  })
}

/** Build, then Run per launch profile and Publish per publish profile (or Test for test projects). */
export function detectDotnetRunConfigurations(options: {
  projectDir: string
  projectFileName: string
  projectXml: string
  launchSettingsText: string | null
  publishProfileNames: readonly string[]
}): DetectedRunConfiguration[] {
  const { projectDir, projectFileName, projectXml } = options
  const projectName = projectFileName.replace(/\.[^.]+$/, '')
  const project = quoteShellArgument(projectFileName)
  const idBase = `dotnet:${projectDir}:${projectFileName}`
  const base = { ecosystem: 'dotnet' as const, projectName, projectDir }
  const configurations: DetectedRunConfiguration[] = [
    {
      ...base,
      id: `${idBase}:build`,
      kind: 'build',
      name: 'Build',
      command: `dotnet build ${project}`
    }
  ]
  if (TEST_PROJECT.test(projectXml)) {
    configurations.push({
      ...base,
      id: `${idBase}:test`,
      kind: 'test',
      name: 'Test',
      command: `dotnet test ${project}`
    })
    return configurations
  }
  if (!RUNNABLE_SDK.test(projectXml) && !EXE_OUTPUT.test(projectXml)) {
    return configurations
  }
  const profiles = readLaunchProfiles(options.launchSettingsText)
  const runs =
    profiles.length > 0
      ? profiles.map((profile) => ({
          ...base,
          id: `${idBase}:run:${profile}`,
          kind: 'run' as const,
          name: profile,
          command: `dotnet run --project ${project} --launch-profile ${quoteShellArgument(profile)}`
        }))
      : [
          {
            ...base,
            id: `${idBase}:run`,
            kind: 'run' as const,
            name: 'Run',
            command: `dotnet run --project ${project}`
          }
        ]
  const publishes =
    options.publishProfileNames.length > 0
      ? options.publishProfileNames.map((profile) => ({
          ...base,
          id: `${idBase}:publish:${profile}`,
          kind: 'publish' as const,
          name: `Publish (${profile})`,
          command: `dotnet publish ${project} -p:PublishProfile=${quoteShellArgument(profile)}`
        }))
      : [
          {
            ...base,
            id: `${idBase}:publish`,
            kind: 'publish' as const,
            name: 'Publish (Release)',
            command: `dotnet publish ${project} -c Release`
          }
        ]
  return [...configurations, ...runs, ...publishes]
}
