import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import {
  activeEditor,
  BACK,
  openEditorFile,
  placeCursorOnLine,
  WORD_RIGHT
} from './helpers/code-navigation-editor'

// Opt-in: the first jump downloads the Vue server (vtsls + Vue's TypeScript plugin) from npm.
const RUN = process.env.ORCA_E2E_CODE_NAVIGATION === '1'

const APP_VUE = `<script setup lang="ts">
import OrderRow from './components/OrderRow.vue'
import { formatTotal } from './total'

const amount = 3
const onSave = () => formatTotal(amount)
</script>

<template>
  <OrderRow :amount="amount" />
  <button @click="onSave">Save</button>
</template>
`

test.describe('code navigation in Vue projects', () => {
  test.skip(!RUN, 'set ORCA_E2E_CODE_NAVIGATION=1 (downloads the language servers)')

  test('F12 on a template component opens its .vue file; Shift+F12 in TypeScript lists .vue usages', async ({
    orcaPage,
    testRepoPath,
    registerPostElectronShutdownCleanup
  }) => {
    test.setTimeout(240_000)
    const fixture = createGoldenWorktree(testRepoPath, 'code-navigation-vue')
    registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
    const root = fixture.worktreePath
    mkdirSync(join(root, 'src', 'components'), { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      '{ "name": "shop", "private": true, "dependencies": { "vue": "^3.5.0" } }\n'
    )
    writeFileSync(
      join(root, 'tsconfig.json'),
      '{ "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "strict": true }, "include": ["src"] }\n'
    )
    writeFileSync(
      join(root, 'src', 'total.ts'),
      'export function formatTotal(amount: number): string {\n  return `$${amount.toFixed(2)}`\n}\n'
    )
    writeFileSync(
      join(root, 'src', 'components', 'OrderRow.vue'),
      '<script setup lang="ts">\ndefineProps<{ amount: number }>()\n</script>\n\n<template>\n  <tr><td>{{ amount }}</td></tr>\n</template>\n'
    )
    writeFileSync(join(root, 'src', 'App.vue'), APP_VUE)

    await waitForSessionReady(orcaPage)
    await activateGoldenWorktree(orcaPage, testRepoPath, root)
    await openEditorFile(orcaPage, root, 'src/App.vue', 'vue')

    await placeCursorOnLine(orcaPage, '<OrderRow')
    await orcaPage.keyboard.press('ArrowRight')
    await orcaPage.keyboard.press('ArrowRight')
    await orcaPage.keyboard.press('F12')
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 150_000 })
      .toEqual({ file: 'OrderRow.vue', line: 1, column: 1 })
    await orcaPage.keyboard.press(BACK)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'App.vue', line: 10, column: 5 })

    // TypeScript 7 cannot see .vue files; the Vue server answers for the project's .ts files too.
    await openEditorFile(orcaPage, root, 'src/total.ts', 'typescript')
    await placeCursorOnLine(orcaPage, 'export function formatTotal')
    await orcaPage.keyboard.press(WORD_RIGHT)
    await orcaPage.keyboard.press(WORD_RIGHT)
    await orcaPage.keyboard.press('ArrowRight')
    await orcaPage.keyboard.press('ArrowRight')
    await orcaPage.keyboard.press('Shift+F12')
    const peek = orcaPage.locator('.reference-zone-widget')
    await expect(peek).toBeVisible({ timeout: 60_000 })
    await expect(peek.locator('.reference-file', { hasText: 'App.vue' })).toBeVisible()
  })
})
