import { readFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'
import { runProcess } from '../../shared/child-process/run-process'
import { ngrokUpstreamPort, type NgrokConfiguredEndpoint } from '../../shared/ngrok/ngrok-types'

/**
 * An endpoint ngrok.yml defines. `request` is its whole definition, renamed, as the agent API takes
 * it; it can hold secrets (a traffic policy's basic-auth credentials), so it stays in main.
 */
export type NgrokConfigEndpoint = Omit<NgrokConfiguredEndpoint, 'online'> & {
  request: { api: 'endpoints' | 'tunnels'; body: Record<string, unknown> }
}

const CONFIG_CHECK_TIMEOUT_MS = 5_000
const MAX_CONFIGURED_ENDPOINTS = 50

/**
 * The name Orca's agent runs a configured endpoint under. Why not its own: `ngrok start --none`
 * still loads ngrok.yml, so its agent already holds that name and refuses a second one.
 */
export function configuredEndpointAgentName(name: string): string {
  return `orca-config-${name}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

/** YAML reads `name: 5016` and `url: 5016` as numbers. */
function asText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** ngrok v3's `endpoints:` list. */
function fromEndpoints(value: unknown): NgrokConfigEndpoint[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const record = asRecord(entry)
    const name = asText(record?.name)
    const upstreamRecord = asRecord(record?.upstream)
    const upstream = asText(upstreamRecord?.url)
    if (!record || !name || !upstreamRecord || !upstream) {
      return []
    }
    const url = asText(record.url)
    // Why the whole entry: its traffic policy (auth, headers) must come along, as with `ngrok start`.
    const body = {
      ...record,
      name: configuredEndpointAgentName(name),
      ...(url ? { url } : {}),
      upstream: { ...upstreamRecord, url: upstream }
    }
    return [
      {
        name,
        url,
        upstream,
        upstreamPort: ngrokUpstreamPort(upstream),
        request: { api: 'endpoints' as const, body }
      }
    ]
  })
}

/** The older `tunnels:` map; only HTTP tunnels, which are what a shared port means. */
function fromTunnels(value: unknown): NgrokConfigEndpoint[] {
  return Object.entries(asRecord(value) ?? {}).flatMap(([name, entry]) => {
    const record = asRecord(entry)
    const proto = asText(record?.proto) ?? 'http'
    const addr = asText(record?.addr)
    if (!record || proto !== 'http' || !addr) {
      return []
    }
    const domain = asText(record.domain) ?? asText(record.hostname)
    const body = { ...record, name: configuredEndpointAgentName(name), proto, addr }
    return [
      {
        name,
        url: domain ? `https://${domain}` : null,
        upstream: addr,
        upstreamPort: ngrokUpstreamPort(addr),
        request: { api: 'tunnels' as const, body }
      }
    ]
  })
}

/** The endpoints an ngrok.yml defines; never anything else, as the file also holds the authtoken. */
export function parseNgrokConfigEndpoints(text: string): NgrokConfigEndpoint[] {
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    return []
  }
  const root = asRecord(document.toJS())
  return [...fromEndpoints(root?.endpoints), ...fromTunnels(root?.tunnels)].slice(
    0,
    MAX_CONFIGURED_ENDPOINTS
  )
}

/**
 * The definition lent to another port: its reserved URL and traffic policy, that port's upstream.
 * Why the whole upstream: settings such as its protocol describe the original server, not this one.
 */
export function lendConfigEndpoint(
  definition: NgrokConfigEndpoint,
  name: string,
  upstream: string
): NgrokConfigEndpoint['request'] {
  const { api, body } = definition.request
  return api === 'endpoints'
    ? { api, body: { ...body, name, upstream: { url: upstream } } }
    : { api, body: { ...body, name, addr: upstream } }
}

/** `ngrok config check` prints "Valid configuration file at <path>". */
export function configPathFromCheckOutput(output: string): string | null {
  return /Valid configuration file at (.+)$/m.exec(output)?.[1]?.trim() ?? null
}

const configPathByBinary = new Map<string, string>()

/**
 * The ngrok.yml the binary itself uses, asking ngrok rather than guessing the per-platform
 * default; null when there is none or it is invalid.
 */
export async function readNgrokConfigText(ngrokPath: string): Promise<string | null> {
  let configPath = configPathByBinary.get(ngrokPath) ?? null
  if (!configPath) {
    const result = await runProcess({
      program: ngrokPath,
      args: ['config', 'check'],
      timeoutMs: CONFIG_CHECK_TIMEOUT_MS
    })
    configPath = configPathFromCheckOutput(`${result.stdout}\n${result.stderr}`)
    if (!configPath) {
      return null
    }
    configPathByBinary.set(ngrokPath, configPath)
  }
  try {
    return await readFile(configPath, 'utf8')
  } catch {
    return null
  }
}
