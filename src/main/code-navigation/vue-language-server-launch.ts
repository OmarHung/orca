import { join } from 'node:path'
import type { LanguageServerLaunch } from './language-server-session'

/**
 * vtsls (tsserver over LSP) with Vue's TypeScript plugin, which turns `.vue` script and
 * template into TypeScript; that plugin, not @vue/language-server, answers navigation.
 */
export function vueServerLaunch(
  installDir: string,
  runtime: { execPath: string; env: NodeJS.ProcessEnv }
): LanguageServerLaunch {
  return {
    program: runtime.execPath,
    args: [
      join(installDir, 'node_modules', '@vtsls', 'language-server', 'bin', 'vtsls.js'),
      '--stdio'
    ],
    // Why Orca's runtime: Vue navigation must not depend on which Node the user installed.
    env: { ...runtime.env, ELECTRON_RUN_AS_NODE: '1' },
    configuration: {
      vtsls: {
        // Why: the project's own TypeScript matches what its build type-checks with.
        autoUseWorkspaceTsdk: true,
        tsserver: {
          globalPlugins: [
            {
              name: '@vue/typescript-plugin',
              location: installDir,
              languages: ['vue'],
              configNamespace: 'typescript',
              enableForWorkspaceTypeScriptVersions: true
            }
          ]
        }
      },
      // Why: the syntax server answers `[]` until the project loads; this makes queries wait.
      typescript: { tsserver: { useSyntaxServer: 'never' } }
    }
  }
}
