// Blocks commits and pushes that would publish private data to the public fork: staged
// additions, staged file names, the commit message and every commit a push would publish are
// matched against built-in rules, the local account name and a literal list kept outside the repo.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import path from 'node:path'

export const DEFAULT_LITERALS_PATH = path.join(
  homedir(),
  '.config',
  'orca-fork',
  'private-strings.txt'
)

const DOCUMENTATION_OR_LOCAL_IP =
  /^(203\.0\.113|198\.51\.100|192\.0\.2|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|255\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|224\.)/
const WELL_KNOWN_IPS = new Set(['1.1.1.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '1.0.0.1'])
const PLACEHOLDER_HOST_LABELS = new Set([
  'acme',
  'example',
  'api',
  'auth',
  'developer',
  'agent',
  'cdn',
  'files',
  'view',
  'support',
  'status'
])
const PLACEHOLDER_MAIL_DOMAIN =
  /(^|\.)(example\.(com|org|net|test)|example|test|invalid|localhost|x\.io)$|users\.noreply\.github\.com$|^anthropic\.com$|^agent\.monday\.com$/

/**
 * Generic rules only; anything naming a real person, host or path belongs in the
 * literal list so the rule set itself never carries private data.
 * Each rule returns the offending fragment, or null.
 */
export const BUILTIN_RULES = [
  {
    id: 'public-ip',
    why: 'public IPv4 address (use 203.0.113.x / 198.51.100.x / 192.0.2.x)',
    find: (line) => {
      for (const match of line.matchAll(
        /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])/g
      )) {
        const octets = match.slice(1, 5).map(Number)
        if (octets.some((n) => n > 255)) {
          continue
        }
        const ip = match[0]
        if (DOCUMENTATION_OR_LOCAL_IP.test(ip) || WELL_KNOWN_IPS.has(ip)) {
          continue
        }
        return ip
      }
      return null
    }
  },
  {
    id: 'monday-account',
    why: 'real monday.com account slug (use acme.monday.com)',
    find: (line) => {
      for (const match of line.matchAll(/\b([a-z0-9-]+)\.monday\.com\b/gi)) {
        if (!PLACEHOLDER_HOST_LABELS.has(match[1].toLowerCase())) {
          return match[0]
        }
      }
      return null
    }
  },
  {
    id: 'taiwan-domain',
    why: '.tw host name (use example.com)',
    find: (line) => line.match(/\b[a-z0-9.-]+\.(com|net|org|edu|gov)\.tw\b/i)?.[0] ?? null
  },
  {
    id: 'email',
    why: 'email outside example/test domains',
    find: (line) => {
      for (const match of line.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
        if (!PLACEHOLDER_MAIL_DOMAIN.test(match[1].toLowerCase())) {
          return match[0]
        }
      }
      return null
    }
  }
]

// Login names too generic to identify anyone; matching them would flag ordinary words.
const GENERIC_ACCOUNT_NAMES = new Set(['root', 'user', 'admin', 'runner', 'ubuntu', 'node'])

export function localAccountName() {
  try {
    return userInfo().username
  } catch {
    return path.basename(homedir())
  }
}

/** The local login name as a whole word, which a captured `ps` row, path or prompt carries verbatim. */
export function accountNameRule(name) {
  if (!name || name.length < 3 || GENERIC_ACCOUNT_NAMES.has(name.toLowerCase())) {
    return null
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `<name>/custom` and `<name>-custom` are the fork's own branch and worktree names, already public.
  const pattern = new RegExp(`(?<!\\w)${escaped}(?!\\w)(?![/-]custom\\b)`, 'i')
  return {
    id: 'account-name',
    why: 'local account name (use a placeholder such as alice)',
    find: (line) => pattern.exec(line)?.[0] ?? null
  }
}

/** Literal strings, one per line; blank lines and `#` comments ignored; matched case-insensitively. */
export function parseLiterals(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export function loadLiterals(filePath = DEFAULT_LITERALS_PATH) {
  return existsSync(filePath) ? parseLiterals(readFileSync(filePath, 'utf8')) : []
}

/**
 * @param {{ file: string, line: number | null, text: string }[]} entries
 * @param {{ literals?: string[], rules?: typeof BUILTIN_RULES }} options
 */
export function findPrivateData(entries, { literals = [], rules = BUILTIN_RULES } = {}) {
  const hits = []
  for (const entry of entries) {
    const lower = entry.text.toLowerCase()
    for (const literal of literals) {
      if (lower.includes(literal.toLowerCase())) {
        hits.push({ ...entry, rule: 'literal', fragment: literal })
      }
    }
    for (const rule of rules) {
      const fragment = rule.find(entry.text)
      if (fragment) {
        hits.push({ ...entry, rule: rule.id, fragment, why: rule.why })
      }
    }
  }
  return hits
}

// The guard's own test file is exempt: it has to contain samples that trip every rule.
const SKIPPED_FILES =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|private-data-guard\.test\.mjs)$|\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|pdf|zip|gz|tgz|node|wasm)$/i

/** Added lines of a unified or combined (merge) diff, tagged with file and new-side line number.
 *  A merge keeps only lines new against every parent: the rest arrived with a parent commit. */
export function parseAddedLines(diff) {
  const entries = []
  let file = null
  let line = 0
  // Marker columns per hunk line: one for a plain diff, one per parent for a combined diff.
  // Zero means the file header, where `+++ ` names the file instead of adding a line.
  let columns = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff ')) {
      file = null
      columns = 0
      continue
    }
    if (raw.startsWith('@@')) {
      columns = raw.match(/^@+/)[0].length - 1
      line = Number(raw.match(/\+(\d+)/)?.[1] ?? 0)
      continue
    }
    if (columns === 0) {
      if (raw.startsWith('+++ ')) {
        file = raw.startsWith('+++ b/') ? raw.slice(6) : null
      }
      continue
    }
    const markers = raw.slice(0, columns)
    if (!file || raw.startsWith('\\') || markers.includes('-')) {
      continue
    }
    if (/^\++$/.test(markers)) {
      entries.push({ file, line, text: raw.slice(columns) })
    }
    line += 1
  }
  return entries.filter((entry) => !SKIPPED_FILES.test(entry.file))
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

export function collectStagedEntries(cwd) {
  const diff = git(
    ['diff', '--cached', '--no-color', '--no-ext-diff', '-U0', '--diff-filter=ACMR'],
    cwd
  )
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], cwd)
    .split('\n')
    .filter(Boolean)
    .map((name) => ({ file: name, line: null, text: name }))
  return [...names, ...parseAddedLines(diff)]
}

function nonEmptyLines(text) {
  return text.split('\n').filter(Boolean)
}

const MISSING_OID = /^0+$/

function hasCommit(oid, cwd) {
  try {
    git(['cat-file', '-e', `${oid}^{commit}`], cwd)
    return true
  } catch {
    return false
  }
}

/** Commits a push publishes, from pre-push's `<local ref> <local oid> <remote ref> <remote oid>`
 *  lines: those on no remote yet, minus rebased copies of commits the remote already holds. */
export function collectPushedCommits(updates, cwd) {
  const commits = new Set()
  for (const update of nonEmptyLines(updates)) {
    const [, localOid, , remoteOid] = update.trim().split(/\s+/)
    if (!localOid || MISSING_OID.test(localOid)) {
      continue
    }
    let pushed = nonEmptyLines(git(['rev-list', localOid, '--not', '--remotes'], cwd))
    if (remoteOid && !MISSING_OID.test(remoteOid) && hasCommit(remoteOid, cwd)) {
      const range = `${remoteOid}...${localOid}`
      const fresh = new Set(
        nonEmptyLines(git(['rev-list', '--cherry-pick', '--right-only', range], cwd))
      )
      pushed = pushed.filter((sha) => fresh.has(sha))
    }
    for (const sha of pushed) {
      commits.add(sha)
    }
  }
  return [...commits]
}

/** One commit's message, added file names and added lines. Each commit is read on its own,
 *  because a value one commit adds and a later one removes still ships in the history. */
export function collectCommitEntries(sha, cwd) {
  const label = sha.slice(0, 10)
  const message = git(['show', '-s', '--format=%B', sha], cwd)
    .split('\n')
    .map((text, index) => ({ file: `${label} message`, line: index + 1, text }))
  const names = nonEmptyLines(
    git(
      ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', sha],
      cwd
    )
  ).map((name) => ({ file: `${label} ${name}`, line: null, text: name }))
  const patch = git(
    ['show', '--format=', '--cc', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR', sha],
    cwd
  )
  const added = parseAddedLines(patch).map((entry) => ({
    ...entry,
    file: `${label} ${entry.file}`
  }))
  return [...message, ...names, ...added]
}

export function collectMessageEntries(messageFile) {
  return readFileSync(messageFile, 'utf8')
    .split('\n')
    .map((text, index) => ({ file: 'commit message', line: index + 1, text }))
    .filter((entry) => !entry.text.startsWith('#'))
}

export function formatHits(hits, literalsPath, action = 'commit') {
  const lines = [`private-data-guard: refusing to ${action}, private data found:`]
  for (const hit of hits) {
    const where = hit.line === null ? `${hit.file} (file name)` : `${hit.file}:${hit.line}`
    const reason = hit.rule === 'literal' ? 'listed in private-strings.txt' : hit.why
    lines.push(`  ${where}  [${hit.rule}] ${hit.fragment}  — ${reason}`)
  }
  lines.push('', `Replace with fictional values. Literal list: ${literalsPath}`)
  if (action === 'push') {
    lines.push(
      'A later commit that removes a value does not unpublish it: rewrite the commit that added it.'
    )
  }
  lines.push(`Bypass only for a false positive: git ${action} --no-verify`)
  return lines.join('\n')
}

function readStdin() {
  return process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
}

function collectEntries(argv, cwd, readUpdates) {
  const messageFlag = argv.indexOf('--message-file')
  if (messageFlag !== -1) {
    return collectMessageEntries(argv[messageFlag + 1])
  }
  if (argv.includes('--staged')) {
    return collectStagedEntries(cwd)
  }
  if (argv.includes('--push')) {
    return collectPushedCommits(readUpdates(), cwd).flatMap((sha) => collectCommitEntries(sha, cwd))
  }
  return null
}

export function run(
  argv,
  {
    cwd = process.cwd(),
    literalsPath = DEFAULT_LITERALS_PATH,
    accountName = localAccountName(),
    readUpdates = readStdin,
    log = console.error
  } = {}
) {
  const entries = collectEntries(argv, cwd, readUpdates)
  if (!entries) {
    log(
      'usage: private-data-guard.mjs --staged | --message-file <path> | --push (ref updates on stdin)'
    )
    return 2
  }
  const rules = [...BUILTIN_RULES, accountNameRule(accountName)].filter(Boolean)
  const hits = findPrivateData(entries, { literals: loadLiterals(literalsPath), rules })
  if (hits.length === 0) {
    return 0
  }
  log(formatHits(hits, literalsPath, argv.includes('--push') ? 'push' : 'commit'))
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = run(process.argv.slice(2))
}
