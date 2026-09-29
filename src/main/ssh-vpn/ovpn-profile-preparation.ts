import path from 'node:path'

/** Where the profile and its files live inside the VPN container (a tmpfs, never on disk). */
export const CONTAINER_PROFILE_DIR = '/run/orca'
export const CONTAINER_PROFILE_PATH = `${CONTAINER_PROFILE_DIR}/profile.ovpn`

const MAX_PROFILE_FILE_BYTES = 1024 * 1024

/** Directives whose first argument is a file OpenVPN reads, unless it is `[inline]`. */
const FILE_DIRECTIVES = new Set([
  'ca',
  'cert',
  'key',
  'tls-auth',
  'tls-crypt',
  'tls-crypt-v2',
  'pkcs12',
  'crl-verify',
  'extra-certs',
  'secret',
  'dh'
])

/** Directives this version cannot honour; each maps to the reason shown to the user. */
const UNSUPPORTED_DIRECTIVES = new Map([
  ['auth-user-pass', 'username/password login'],
  ['static-challenge', 'one-time codes (MFA)'],
  ['askpass', 'password-protected private keys'],
  ['pkcs11-providers', 'hardware tokens'],
  ['pkcs11-id', 'hardware tokens'],
  ['cryptoapicert', 'the Windows certificate store'],
  ['management-external-key', 'externally held keys'],
  ['management-external-cert', 'externally held certificates'],
  ['tls-verify', 'custom certificate-check scripts'],
  ['config', 'profiles that include other profiles']
])

// Why dropped: they would daemonize or log away from the stdout Orca reads, point at host paths,
// or run host scripts that do not exist in the container. Orca supplies its own `up` script.
const DROPPED_DIRECTIVES = new Set([
  'daemon',
  'log',
  'log-append',
  'syslog',
  'cd',
  'chroot',
  'writepid',
  'script-security',
  'up',
  'down',
  'down-pre',
  'up-restart',
  'route-up',
  'route-pre-down',
  'ipchange'
])

const ENCRYPTED_PEM = /BEGIN ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/

export type PreparedOvpnFile = { hostPath: string; containerPath: string; content: Buffer }

export type PreparedOvpnProfile = {
  /** The profile as written into the container: host paths rewritten, dropped lines removed. */
  config: string
  /** Files the profile references, to write next to it. */
  files: PreparedOvpnFile[]
}

export class OvpnProfileError extends Error {
  override name = 'OvpnProfileError'
}

type ReadFile = (filePath: string) => Promise<Buffer>

/** Splits one config line the way OpenVPN does: whitespace, "double" / 'single' quotes, `\` escapes. */
export function tokenizeOvpnLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let quote: '"' | "'" | null = null
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote === "'") {
      if (char === "'") {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '\\' && index + 1 < line.length) {
      current += line[++index]
      hasToken = true
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      continue
    }
    // Why: like OpenVPN, `#` or `;` opening a token starts a trailing comment.
    if ((char === '#' || char === ';') && !hasToken) {
      break
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += char
    hasToken = true
  }
  if (hasToken) {
    tokens.push(current)
  }
  return tokens
}

function quoteOvpnArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function containerFileName(index: number, hostPath: string): string {
  const base = path
    .basename(hostPath)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 60)
  return `${CONTAINER_PROFILE_DIR}/f${index}-${base || 'file'}`
}

function isComment(trimmed: string): boolean {
  return trimmed.startsWith('#') || trimmed.startsWith(';')
}

async function readBounded(readFile: ReadFile, filePath: string, label: string): Promise<Buffer> {
  let content: Buffer
  try {
    content = await readFile(filePath)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new OvpnProfileError(`Cannot read ${label} ${filePath}: ${reason}`)
  }
  if (content.byteLength > MAX_PROFILE_FILE_BYTES) {
    throw new OvpnProfileError(`${label} ${filePath} is larger than 1 MB`)
  }
  return content
}

function assertKeyNotEncrypted(content: string, where: string): void {
  if (ENCRYPTED_PEM.test(content)) {
    throw new OvpnProfileError(
      `The private key in ${where} is password-protected, which is not supported yet`
    )
  }
}

/**
 * Reads an .ovpn profile and everything it references, and rewrites it for the VPN container.
 * Throws OvpnProfileError for profiles this version cannot connect without user input.
 */
export async function prepareOvpnProfile(
  ovpnPath: string,
  readFile: ReadFile
): Promise<PreparedOvpnProfile> {
  const source = (await readBounded(readFile, ovpnPath, 'profile')).toString('utf8')
  const profileDir = path.dirname(ovpnPath)
  const output: string[] = []
  const files: PreparedOvpnFile[] = []
  const unsupported = new Set<string>()
  let inlineTag: string | null = null
  let inlineBody = ''

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (inlineTag) {
      output.push(line)
      if (trimmed.toLowerCase() === `</${inlineTag}>`) {
        if (inlineTag === 'key') {
          assertKeyNotEncrypted(inlineBody, 'the profile')
        }
        inlineTag = null
        inlineBody = ''
      } else {
        inlineBody += `${line}\n`
      }
      continue
    }
    const openTag = /^<([A-Za-z0-9-]+)>$/.exec(trimmed)
    if (openTag) {
      inlineTag = openTag[1].toLowerCase()
      output.push(line)
      continue
    }
    if (!trimmed || isComment(trimmed)) {
      output.push(line)
      continue
    }
    const [rawDirective, ...args] = tokenizeOvpnLine(trimmed)
    // Why: OpenVPN accepts the command-line spelling (`--ca`) in config files too.
    const directive = rawDirective.replace(/^--/, '').toLowerCase()
    const unsupportedReason = UNSUPPORTED_DIRECTIVES.get(directive)
    if (unsupportedReason) {
      unsupported.add(unsupportedReason)
      continue
    }
    if (DROPPED_DIRECTIVES.has(directive)) {
      continue
    }
    if (!FILE_DIRECTIVES.has(directive) || args.length === 0 || args[0] === '[inline]') {
      output.push(line)
      continue
    }
    if (directive === 'crl-verify' && args[1] === 'dir') {
      unsupported.add('certificate revocation directories')
      continue
    }
    const hostPath = path.resolve(profileDir, args[0])
    const content = await readBounded(readFile, hostPath, `file referenced by "${directive}"`)
    if (directive === 'key') {
      assertKeyNotEncrypted(content.toString('utf8'), hostPath)
    }
    const containerPath = containerFileName(files.length, hostPath)
    files.push({ hostPath, containerPath, content })
    output.push([directive, containerPath, ...args.slice(1)].map(quoteOvpnArg).join(' '))
  }

  if (unsupported.size > 0) {
    throw new OvpnProfileError(
      `This profile needs ${[...unsupported].join(', ')}, which Orca's VPN connection does not support yet. Use a certificate-only profile.`
    )
  }
  if (inlineTag) {
    throw new OvpnProfileError(`The profile's <${inlineTag}> block is never closed`)
  }
  const config = output.join('\n')
  return { config: config.endsWith('\n') ? config : `${config}\n`, files }
}
