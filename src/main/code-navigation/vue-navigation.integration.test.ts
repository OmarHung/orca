import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { extractArchive } from '../debug/adapters/archive-extract'
import { CodeNavigationService } from './code-navigation-service'
import { ensureNpmPackageSetInstalled } from './npm-package-set-installer'
import { VUE_LANGUAGE_SERVER_PACKAGES } from './vue-language-server-manifest'
import { vueServerLaunch } from './vue-language-server-launch'
import type {
  CodeNavigationFeature,
  CodeNavigationQuery
} from '../../shared/code-navigation/code-navigation-types'

// Opt-in (network): where to install the pinned server set; reruns reuse it.
const serverBaseDir = process.env.ORCA_TEST_VUE_SERVER_DIR

const FILES: Record<string, string> = {
  'package.json': '{ "name": "shop", "private": true, "dependencies": { "vue": "^3.5.0" } }\n',
  'tsconfig.json':
    '{ "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "strict": true }, "include": ["src"] }\n',
  'src/total.ts':
    'export function formatTotal(amount: number): string {\n  return `$${amount.toFixed(2)}`\n}\n',
  'src/components/OrderRow.vue':
    '<script setup lang="ts">\ndefineProps<{ amount: number }>()\n</script>\n\n<template>\n  <tr><td>{{ amount }}</td></tr>\n</template>\n',
  'src/App.vue': [
    '<script setup lang="ts">',
    "import OrderRow from './components/OrderRow.vue'",
    "import { formatTotal } from './total'",
    '',
    'const amount = 3',
    'const onSave = () => formatTotal(amount)',
    '</script>',
    '',
    '<template>',
    '  <OrderRow :amount="amount" />',
    '  <button @click="onSave">{{ formatTotal(amount) }}</button>',
    '</template>',
    ''
  ].join('\n'),
  // A Nuxt app as `nuxi prepare` leaves it: auto-imports declared in .nuxt/types.
  'nuxt-app/package.json':
    '{ "name": "nuxt-app", "private": true, "dependencies": { "nuxt": "^4.0.0", "vue": "^3.5.0" } }\n',
  'nuxt-app/tsconfig.json':
    '{ "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "strict": true }, "include": ["app", ".nuxt/types"] }\n',
  'nuxt-app/.nuxt/types/imports.d.ts':
    "export {}\ndeclare global {\n  const useToast: typeof import('../../app/composables/useToast').useToast\n}\n",
  'nuxt-app/app/composables/useToast.ts':
    'export function useToast() {\n  return { show: (text: string) => text }\n}\n',
  'nuxt-app/app/pages/index.vue':
    '<script setup lang="ts">\nconst { show } = useToast()\nshow(\'hi\')\n</script>\n'
}

let root = ''
let service: CodeNavigationService

async function query(feature: CodeNavigationFeature, relativePath: string, marker: string) {
  const path = join(root, relativePath)
  const text = await readFile(path, 'utf8')
  const offset = text.indexOf(marker.replace('|', '')) + marker.indexOf('|')
  const before = text.slice(0, offset).split('\n')
  const request: CodeNavigationQuery = {
    // Why the renderer's kinds: main must route a Vue project's TypeScript to the Vue server.
    kind: relativePath.endsWith('.vue') ? 'vue' : 'typescript',
    root,
    feature,
    userInitiated: true,
    document: {
      path,
      languageId: relativePath.endsWith('.vue') ? 'vue' : 'typescript',
      version: 1,
      text
    },
    position: { line: before.length - 1, character: before.at(-1)!.length }
  }
  const result = await service.query(request, () => {})
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.locations.map((location) => ({
    file: location.path.slice(root.length + 1).replace(/\\/g, '/'),
    line: location.range.start.line
  }))
}

describe.skipIf(!serverBaseDir)('Vue navigation against vtsls with the Vue plugin', () => {
  beforeAll(async () => {
    const installDir = await ensureNpmPackageSetInstalled(
      VUE_LANGUAGE_SERVER_PACKAGES,
      serverBaseDir!,
      {
        download: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
        extract: extractArchive
      }
    )
    root = await realpath(await mkdtemp(join(tmpdir(), 'orca-vue-it-')))
    for (const [relativePath, text] of Object.entries(FILES)) {
      await mkdir(dirname(join(root, relativePath)), { recursive: true })
      await writeFile(join(root, relativePath), text)
    }
    // Why install vue: template expressions only type-check against the real Vue types.
    await runProcess({
      program: (await resolveCommandOnLocalPath('npm'))!,
      args: ['install', '--no-audit', '--no-fund', '--ignore-scripts'],
      cwd: root,
      timeoutMs: 180_000
    })
    await symlink(join(root, 'node_modules'), join(root, 'nuxt-app', 'node_modules'), 'junction')
    service = new CodeNavigationService({
      prepareLaunch: async (kind) => {
        if (kind !== 'vue') {
          throw new Error(`routed to ${kind} instead of the Vue server`)
        }
        return vueServerLaunch(installDir, { execPath: process.execPath, env: process.env })
      },
      isInstalled: async () => true
    })
  }, 300_000)

  afterAll(async () => {
    await service?.disposeAll()
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('follows components, handlers and imports from a .vue template and script', async () => {
    expect(await query('definition', 'src/App.vue', '<Order|Row')).toEqual([
      { file: 'src/components/OrderRow.vue', line: 0 }
    ])
    expect(await query('definition', 'src/App.vue', '@click="onSa|ve"')).toEqual([
      { file: 'src/App.vue', line: 5 }
    ])
    expect(await query('definition', 'src/App.vue', '{{ formatTo|tal(amount) }}')).toEqual([
      { file: 'src/total.ts', line: 0 }
    ])
  }, 120_000)

  it('finds usages in .vue files from a TypeScript file of the project', async () => {
    const usages = await query('references', 'src/total.ts', 'function formatTo|tal')
    expect(usages.map((usage) => usage.file)).toEqual(
      expect.arrayContaining(['src/total.ts', 'src/App.vue'])
    )
  }, 120_000)

  it('follows a Nuxt auto-import to its composable instead of the generated declaration', async () => {
    expect(await query('definition', 'nuxt-app/app/pages/index.vue', 'useTo|ast()')).toEqual([
      { file: 'nuxt-app/app/composables/useToast.ts', line: 0 }
    ])
  }, 120_000)
})
