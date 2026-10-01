import { SSH_VPN_TUNNEL_USER } from '../../shared/ssh-vpn-command-format'

/**
 * Decides from `iptables -S OUTPUT` whether a borrowed container keeps the tunnel user on the
 * VPN the way Orca's own firewall does: out through tun+ (plus DNS to fixed resolvers), every
 * other packet rejected. Anything it does not recognise counts as unsafe.
 */

type RuleVerdict = 'skip' | 'allowed' | 'blocks' | 'unsafe'

const RULE_OPTIONS = new Set([
  '-o',
  '-d',
  '-p',
  '-j',
  '-m',
  '--uid-owner',
  '--dport',
  '--reject-with'
])

function parseRule(line: string): Map<string, string> | null {
  const tokens = line.trim().split(/\s+/)
  const options = new Map<string, string>()
  for (let index = 2; index < tokens.length; index += 2) {
    const key = tokens[index]
    const value = tokens[index + 1]
    // Why null: negations (`!`), other matches and comments could widen what the rule lets out.
    if (value === undefined || !RULE_OPTIONS.has(key)) {
      return null
    }
    // Why skip -m: module names (owner, udp, tcp) only enable the options that follow them.
    if (key === '-m') {
      continue
    }
    if (options.has(key)) {
      return null
    }
    options.set(key, value)
  }
  return options
}

function hasOnly(rule: Map<string, string>, allowed: readonly string[]): boolean {
  return [...rule.keys()].every((key) => allowed.includes(key))
}

function classifyRule(rule: Map<string, string>, tunnelUid: string): RuleVerdict {
  const owner = rule.get('--uid-owner')
  const target = rule.get('-j')
  const isTunnel = owner === tunnelUid || owner === SSH_VPN_TUNNEL_USER
  if (owner !== undefined && !isTunnel) {
    // Why: a uid range or another name might still cover the tunnel user.
    return /^\d+$/.test(owner) ? 'skip' : 'unsafe'
  }
  if (target === 'DROP' || target === 'REJECT') {
    return hasOnly(rule, ['-j', '--uid-owner', '--reject-with']) ? 'blocks' : 'skip'
  }
  if (target !== 'ACCEPT') {
    return 'unsafe'
  }
  if (
    /^(lo|tun[0-9+]*)$/.test(rule.get('-o') ?? '') &&
    hasOnly(rule, ['-o', '-j', '--uid-owner'])
  ) {
    return 'allowed'
  }
  const isDns =
    isTunnel &&
    /\/(32|128)$/.test(rule.get('-d') ?? '') &&
    (rule.get('-p') === 'udp' || rule.get('-p') === 'tcp') &&
    rule.get('--dport') === '53' &&
    hasOnly(rule, ['-d', '-p', '--dport', '-j', '--uid-owner'])
  return isDns ? 'allowed' : 'unsafe'
}

/** True when every tunnel-user packet that is not VPN or pinned DNS traffic is dropped. */
export function keepsTunnelUserOnVpn(rules: string, tunnelUid: string): boolean {
  let policy: string | undefined
  for (const line of rules.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }
    if (line.startsWith('-P OUTPUT ')) {
      policy = line.trim().split(/\s+/)[2]
      continue
    }
    if (!line.startsWith('-A OUTPUT ')) {
      return false
    }
    const rule = parseRule(line)
    const verdict = rule ? classifyRule(rule, tunnelUid) : 'unsafe'
    if (verdict === 'unsafe') {
      return false
    }
    if (verdict === 'blocks') {
      return true
    }
  }
  return policy === 'DROP'
}
