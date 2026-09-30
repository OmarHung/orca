import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const TARGETS_FILE = 'csharp-razor-design-time.targets'

/**
 * MSBuild file csharp-ls's design-time builds import (via CustomAfterMicrosoftCommonTargets).
 * The Razor SDK forces UseRazorSourceGenerator=false for netcoreapp3.x and net5.0, so views
 * there get no generated C#; this pulls the SDK's own generator targets in anyway.
 */
export const CSHARP_RAZOR_DESIGN_TIME_TARGETS = `<Project>
  <PropertyGroup>
    <_OrcaRazorGeneratorTargets>$(MSBuildSDKsPath)/Microsoft.NET.Sdk.Razor/targets/Microsoft.NET.Sdk.Razor.SourceGenerators.targets</_OrcaRazorGeneratorTargets>
    <_OrcaUseRazorGenerator Condition="'$(MSBuildSDKsPath)' != ''
        AND Exists('$(_OrcaRazorGeneratorTargets)')
        AND '$(TargetFrameworkIdentifier)' == '.NETCoreApp'
        AND $([MSBuild]::VersionGreaterThanOrEquals('$(TargetFrameworkVersion)', '3.0'))
        AND $([MSBuild]::VersionLessThan('$(TargetFrameworkVersion)', '6.0'))">true</_OrcaUseRazorGenerator>
  </PropertyGroup>

  <!-- Tag helper discovery compiles the project first: a cycle once the generator runs inside that compile. -->
  <Target Name="_OrcaSkipRazorTagHelperDiscovery"
          BeforeTargets="GenerateMSBuildEditorConfigFileShouldRun"
          Condition="'$(_OrcaUseRazorGenerator)' == 'true' AND '$(UseRazorSourceGenerator)' != 'true'">
    <PropertyGroup>
      <PrepareForRazorGenerateDependsOn>$([MSBuild]::Unescape($(PrepareForRazorGenerateDependsOn.Replace('ResolveTagHelperRazorGenerateInputs', ''))))</PrepareForRazorGenerateDependsOn>
    </PropertyGroup>
  </Target>

  <Import Project="$(_OrcaRazorGeneratorTargets)" Condition="'$(_OrcaUseRazorGenerator)' == 'true'" />
</Project>
`

/** Writes the targets file under `baseDir` when missing or stale; returns its path. */
export async function ensureCsharpRazorDesignTimeTargets(baseDir: string): Promise<string> {
  const path = join(baseDir, TARGETS_FILE)
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current !== CSHARP_RAZOR_DESIGN_TIME_TARGETS) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, CSHARP_RAZOR_DESIGN_TIME_TARGETS)
  }
  return path
}
