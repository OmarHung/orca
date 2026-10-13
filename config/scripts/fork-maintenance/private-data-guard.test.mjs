import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectStagedEntries,
  findPrivateData,
  formatHits,
  parseAddedLines,
  parseLiterals,
  run
} from './private-data-guard.mjs'

const entry = (text, file = 'a.ts', line = 1) => ({ file, line, text })

describe('findPrivateData built-in rules', () => {
  it('flags public IPv4 addresses but not documentation, private or version-like values', () => {
    const hits = findPrivateData([
      entry('host: 34.81.200.9'),
      entry('ip: 203.0.113.10 and 198.51.100.7 and 192.0.2.1'),
      entry('lan: 10.0.0.2, 192.168.1.5, 172.16.4.4, 127.0.0.1, 0.0.0.0'),
      entry('dns: 1.1.1.1, 8.8.8.8'),
      entry("'@xterm/xterm@6.1.0-beta.303': config/patches/x.patch"),
      entry('v1.4.129.0 nope 256.1.1.1')
    ])
    expect(hits.map((h) => h.fragment)).toEqual(['34.81.200.9'])
  })

  it('flags a real monday account slug but allows placeholder hosts', () => {
    const hits = findPrivateData([
      entry('https://acme.monday.com/boards/1'),
      entry('https://api.monday.com/v2'),
      entry('a@agent.monday.com'),
      entry('https://contoso-corp.monday.com/boards/1')
    ])
    expect(hits.map((h) => [h.rule, h.fragment])).toEqual([
      ['monday-account', 'contoso-corp.monday.com']
    ])
  })

  it('flags .tw host names and non-placeholder emails', () => {
    const hits = findPrivateData([
      entry('https://www.contoso.com.tw/'),
      entry('vivian@example.com, test@example.test, bob@x.io'),
      entry('Co-Authored-By: Bot <noreply@anthropic.com>'),
      entry('someone@contoso.com')
    ])
    expect(hits.map((h) => [h.rule, h.fragment])).toEqual([
      ['taiwan-domain', 'www.contoso.com.tw'],
      ['email', 'someone@contoso.com']
    ])
  })

  it('matches literals case-insensitively and reports the file and line', () => {
    const hits = findPrivateData([entry('const x = "Contoso Industries"', 'docs/x.md', 7)], {
      literals: parseLiterals('# clients\ncontoso industries\n\n')
    })
    expect(hits).toEqual([
      {
        file: 'docs/x.md',
        line: 7,
        text: 'const x = "Contoso Industries"',
        rule: 'literal',
        fragment: 'contoso industries'
      }
    ])
  })
})

describe('parseAddedLines', () => {
  it('keeps only added lines with their new-side line numbers and skips lockfiles', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '-old',
      '+new one',
      '+new two',
      '@@ -10 +11,2 @@',
      '+later',
      'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
      '--- a/pnpm-lock.yaml',
      '+++ b/pnpm-lock.yaml',
      '@@ -1 +1 @@',
      '+ignored'
    ].join('\n')
    expect(parseAddedLines(diff)).toEqual([
      { file: 'src/a.ts', line: 2, text: 'new one' },
      { file: 'src/a.ts', line: 3, text: 'new two' },
      { file: 'src/a.ts', line: 11, text: 'later' }
    ])
  })
})

describe('formatHits', () => {
  it('names the location, rule and fragment', () => {
    const text = formatHits(
      [
        {
          file: 'a.ts',
          line: 3,
          rule: 'public-ip',
          fragment: '34.81.200.9',
          why: 'public IPv4 address'
        },
        { file: 'secret.ovpn', line: null, rule: 'literal', fragment: 'secret.ovpn' }
      ],
      '/home/x/private-strings.txt'
    )
    expect(text).toContain('a.ts:3  [public-ip] 34.81.200.9')
    expect(text).toContain('secret.ovpn (file name)  [literal] secret.ovpn')
    expect(text).toContain('/home/x/private-strings.txt')
  })
})

describe('run against a real index', () => {
  let repo
  let literalsPath

  function git(...args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  }

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'private-data-guard-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    literalsPath = path.join(repo, 'literals.txt')
    writeFileSync(literalsPath, 'contoso\n')
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('passes a clean staged change and fails one that adds private data or a private file name', () => {
    const logs = []
    const log = (message) => logs.push(message)
    writeFileSync(path.join(repo, 'clean.ts'), 'const ip = "203.0.113.10"\n')
    git('add', 'clean.ts')
    expect(run(['--staged'], { cwd: repo, literalsPath, log })).toBe(0)
    expect(collectStagedEntries(repo)).toEqual([
      { file: 'clean.ts', line: null, text: 'clean.ts' },
      { file: 'clean.ts', line: 1, text: 'const ip = "203.0.113.10"' }
    ])

    writeFileSync(path.join(repo, 'contoso-notes.md'), 'server 34.81.200.9\n')
    git('add', 'contoso-notes.md')
    expect(run(['--staged'], { cwd: repo, literalsPath, log })).toBe(1)
    expect(logs.at(-1)).toContain('contoso-notes.md (file name)  [literal] contoso')
    expect(logs.at(-1)).toContain('contoso-notes.md:1  [public-ip] 34.81.200.9')
  })

  it('checks the commit message and ignores comment lines', () => {
    const logs = []
    const messageFile = path.join(repo, 'COMMIT_EDITMSG')
    writeFileSync(messageFile, 'fix: tidy\n# On branch main contoso\n')
    expect(
      run(['--message-file', messageFile], { cwd: repo, literalsPath, log: (m) => logs.push(m) })
    ).toBe(0)
    writeFileSync(messageFile, 'fix: handle Contoso login\n')
    expect(
      run(['--message-file', messageFile], { cwd: repo, literalsPath, log: (m) => logs.push(m) })
    ).toBe(1)
    expect(logs.at(-1)).toContain('commit message:1  [literal] contoso')
  })

  it('returns usage when no mode is given', () => {
    const logs = []
    expect(run([], { cwd: repo, literalsPath, log: (m) => logs.push(m) })).toBe(2)
    expect(logs[0]).toContain('usage')
  })
})
