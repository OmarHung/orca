import { describe, expect, it } from 'vitest'
import { keepsTunnelUserOnVpn } from './borrowed-container-firewall'

// Captured from Orca's own VPN image (iptables v1.8.11 nf_tables, Docker Desktop, tunnel uid 1000).
const ORCA_IPV4 = [
  '-P OUTPUT ACCEPT',
  '-A OUTPUT -o lo -j ACCEPT',
  '-A OUTPUT -o tun+ -m owner --uid-owner 1000 -j ACCEPT',
  '-A OUTPUT -d 192.168.65.7/32 -p udp -m owner --uid-owner 1000 -m udp --dport 53 -j ACCEPT',
  '-A OUTPUT -d 192.168.65.7/32 -p tcp -m owner --uid-owner 1000 -m tcp --dport 53 -j ACCEPT',
  '-A OUTPUT -m owner --uid-owner 1000 -j REJECT --reject-with icmp-port-unreachable'
].join('\n')

const ORCA_IPV6 = [
  '-P OUTPUT ACCEPT',
  '-A OUTPUT -o lo -j ACCEPT',
  '-A OUTPUT -o tun+ -m owner --uid-owner 1000 -j ACCEPT',
  '-A OUTPUT -m owner --uid-owner 1000 -j REJECT --reject-with icmp6-port-unreachable'
].join('\n')

function withRuleBeforeReject(rules: string, rule: string): string {
  const lines = rules.split('\n')
  return [...lines.slice(0, -1), rule, lines.at(-1)].join('\n')
}

describe('keepsTunnelUserOnVpn', () => {
  it("accepts Orca's own IPv4 and IPv6 rules", () => {
    expect(keepsTunnelUserOnVpn(ORCA_IPV4, '1000')).toBe(true)
    expect(keepsTunnelUserOnVpn(ORCA_IPV6, '1000')).toBe(true)
  })

  it('refuses rules with no final reject, or a reject for another user', () => {
    expect(keepsTunnelUserOnVpn(ORCA_IPV4.split('\n').slice(0, -1).join('\n'), '1000')).toBe(false)
    expect(keepsTunnelUserOnVpn(ORCA_IPV4, '1001')).toBe(false)
    expect(keepsTunnelUserOnVpn('', '1000')).toBe(false)
  })

  it('accepts a DROP policy in place of the final reject', () => {
    const rules = ORCA_IPV6.replace('-P OUTPUT ACCEPT', '-P OUTPUT DROP').split('\n')
    expect(keepsTunnelUserOnVpn(rules.slice(0, -1).join('\n'), '1000')).toBe(true)
  })

  it.each([
    ['an ACCEPT for everyone', '-A OUTPUT -j ACCEPT'],
    ['an ACCEPT through eth0', '-A OUTPUT -o eth0 -m owner --uid-owner 1000 -j ACCEPT'],
    ['a uid range that covers the tunnel user', '-A OUTPUT -m owner --uid-owner 0-2000 -j ACCEPT'],
    ['a negated match', '-A OUTPUT ! -o tun+ -m owner --uid-owner 1000 -j ACCEPT'],
    [
      'DNS to a whole network',
      '-A OUTPUT -d 0.0.0.0/1 -p udp -m owner --uid-owner 1000 -m udp --dport 53 -j ACCEPT'
    ],
    ['a jump to another chain', '-A OUTPUT -j DOCKER-USER'],
    ['a comment', '-A OUTPUT -m comment --comment "x" -j ACCEPT']
  ])('refuses %s before the reject', (_label, rule) => {
    expect(keepsTunnelUserOnVpn(withRuleBeforeReject(ORCA_IPV4, rule), '1000')).toBe(false)
  })

  it('ignores rules for other users and rules that only drop', () => {
    const rules = withRuleBeforeReject(
      withRuleBeforeReject(ORCA_IPV4, '-A OUTPUT -m owner --uid-owner 0 -j ACCEPT'),
      '-A OUTPUT -d 10.0.0.0/8 -j DROP'
    )
    expect(keepsTunnelUserOnVpn(rules, '1000')).toBe(true)
  })

  it('accepts the user named instead of numbered', () => {
    expect(
      keepsTunnelUserOnVpn(ORCA_IPV6.replaceAll('--uid-owner 1000', '--uid-owner tunnel'), '1000')
    ).toBe(true)
  })
})
