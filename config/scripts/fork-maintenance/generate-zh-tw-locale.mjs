#!/usr/bin/env node
// Generates the Traditional Chinese (Taiwan) catalog, zh-TW.json, from the Simplified one.
//
//   node config/scripts/fork-maintenance/generate-zh-tw-locale.mjs [--check]
//
// OpenCC's `cn → twp` converts characters and Taiwan phrasing (文件→檔案, 默认→預設, 服务器→伺服器);
// zh-tw-term-overrides.json then fixes the UI terms it leaves Mainland-style. sync-upstream.mjs
// runs this after every rebase, so strings upstream adds to zh.json reach zh-TW.json too.
// --check exits 1 when zh-TW.json is stale instead of rewriting it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { applyTermOverrides, convertCatalog, formatCatalog } from './zh-tw-locale-conversion.mjs'

const OPENCC_VERSION = '1.4.2'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const localesDir = path.join(repoRoot, 'src', 'renderer', 'src', 'i18n', 'locales')
const sourcePath = path.join(localesDir, 'zh.json')
const targetPath = path.join(localesDir, 'zh-TW.json')
const overridesPath = path.join(import.meta.dirname, 'zh-tw-term-overrides.json')
// Why a private cache instead of a dependency: adding it to package.json would change the lockfile,
// which conflicts with nearly every upstream release the fork is rebased onto.
const openccDir = path.join(repoRoot, 'node_modules', '.cache', 'fork-opencc-js', OPENCC_VERSION)

function loadOpenCC() {
  if (!existsSync(path.join(openccDir, 'node_modules', 'opencc-js', 'package.json'))) {
    mkdirSync(openccDir, { recursive: true })
    writeFileSync(path.join(openccDir, 'package.json'), '{ "private": true }\n')
    execFileSync(
      'npm',
      ['install', '--no-audit', '--no-fund', '--silent', `opencc-js@${OPENCC_VERSION}`],
      { cwd: openccDir, stdio: 'inherit' }
    )
  }
  return createRequire(path.join(openccDir, 'package.json'))('opencc-js')
}

const OpenCC = loadOpenCC()
const toTaiwan = OpenCC.Converter({ from: 'cn', to: 'twp' })
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'))
const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
const output = formatCatalog(
  convertCatalog(source, (text) => applyTermOverrides(toTaiwan(text), overrides))
)

const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null
if (process.argv.includes('--check')) {
  if (current !== output) {
    console.error(
      'zh-TW.json is out of date with zh.json; run node config/scripts/fork-maintenance/generate-zh-tw-locale.mjs'
    )
    process.exit(1)
  }
  console.log('zh-TW.json is up to date.')
} else if (current === output) {
  console.log('zh-TW.json is already up to date.')
} else {
  writeFileSync(targetPath, output)
  console.log(`Wrote ${path.relative(repoRoot, targetPath)}.`)
}
