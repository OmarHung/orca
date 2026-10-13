// Blocks commits that would push private data to the public fork: staged
// additions, staged file names and the commit message are matched against
// built-in rules plus a literal list kept outside the repo.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
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

/** Added lines of a unified diff, tagged with file and new-side line number. */
export function parseAddedLines(diff) {
  const entries = []
  let file = null
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : null
      continue
    }
    if (raw.startsWith('@@')) {
      line = Number(raw.match(/\+(\d+)/)?.[1] ?? 0)
      continue
    }
    if (!file || raw.startsWith('---')) {
      continue
    }
    if (raw.startsWith('+')) {
      entries.push({ file, line, text: raw.slice(1) })
      line += 1
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      line += 1
    }
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

export function collectMessageEntries(messageFile) {
  return readFileSync(messageFile, 'utf8')
    .split('\n')
    .map((text, index) => ({ file: 'commit message', line: index + 1, text }))
    .filter((entry) => !entry.text.startsWith('#'))
}

export function formatHits(hits, literalsPath) {
  const lines = ['private-data-guard: refusing to commit, private data found:']
  for (const hit of hits) {
    const where = hit.line === null ? `${hit.file} (file name)` : `${hit.file}:${hit.line}`
    const reason = hit.rule === 'literal' ? 'listed in private-strings.txt' : hit.why
    lines.push(`  ${where}  [${hit.rule}] ${hit.fragment}  — ${reason}`)
  }
  lines.push(
    '',
    `Replace with fictional values. Literal list: ${literalsPath}`,
    'Bypass only for a false positive: git commit --no-verify'
  )
  return lines.join('\n')
}

export function run(
  argv,
  { cwd = process.cwd(), literalsPath = DEFAULT_LITERALS_PATH, log = console.error } = {}
) {
  const messageFlag = argv.indexOf('--message-file')
  const entries =
    messageFlag !== -1
      ? collectMessageEntries(argv[messageFlag + 1])
      : argv.includes('--staged')
        ? collectStagedEntries(cwd)
        : null
  if (!entries) {
    log('usage: private-data-guard.mjs --staged | --message-file <path>')
    return 2
  }
  const hits = findPrivateData(entries, { literals: loadLiterals(literalsPath) })
  if (hits.length === 0) {
    return 0
  }
  log(formatHits(hits, literalsPath))
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = run(process.argv.slice(2))
}
