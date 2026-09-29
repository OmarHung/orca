import { createHash } from 'node:crypto'
import { SSH_VPN_TUNNEL_USER } from '../../shared/ssh-vpn-command-format'

export const SSH_VPN_LABEL = 'dev.orca.ssh-vpn'
export const SSH_VPN_DNS_SCRIPT_PATH = '/usr/local/bin/orca-vpn-dns'
export const SSH_VPN_FIREWALL_SCRIPT_PATH = '/usr/local/bin/orca-vpn-firewall'

// Why pinned by digest: the image is built on the user's machine, so a moved tag must not change it.
const ALPINE_BASE =
  'alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8'

/**
 * OpenVPN's `--up` hook: writes the DNS servers and search domains the server pushed into the
 * container's resolv.conf, so names that only resolve inside the VPN work for `nc`.
 */
const DNS_SCRIPT = `#!/bin/sh
servers=""
domains=""
i=1
while :; do
  eval "opt=\\\${foreign_option_$i:-}"
  [ -z "$opt" ] && break
  case "$opt" in
    "dhcp-option DNS "*) servers="$servers \${opt#dhcp-option DNS }" ;;
    "dhcp-option DOMAIN "*|"dhcp-option DOMAIN-SEARCH "*) domains="$domains \${opt##* }" ;;
  esac
  i=$((i + 1))
done
if [ -n "$servers" ]; then
  {
    [ -n "$domains" ] && echo "search$domains"
    for server in $servers; do echo "nameserver $server"; done
  } > /etc/resolv.conf
fi
exit 0
`

/**
 * Fail closed inside the container: the tunnel user (every per-connection `nc`) may only leave
 * through the VPN's tun device. If OpenVPN never installs a route to the host, or drops its routes
 * while reconnecting, connections are refused instead of leaving through Docker's own network.
 * DNS stays allowed so names still resolve when the VPN pushes no DNS server.
 */
const FIREWALL_SCRIPT = `#!/bin/sh
set -e
for ipt in iptables ip6tables; do
  $ipt -A OUTPUT -o lo -j ACCEPT
  $ipt -A OUTPUT -m owner --uid-owner ${SSH_VPN_TUNNEL_USER} -o tun+ -j ACCEPT
  $ipt -A OUTPUT -m owner --uid-owner ${SSH_VPN_TUNNEL_USER} -p udp --dport 53 -j ACCEPT
  $ipt -A OUTPUT -m owner --uid-owner ${SSH_VPN_TUNNEL_USER} -p tcp --dport 53 -j ACCEPT
  $ipt -A OUTPUT -m owner --uid-owner ${SSH_VPN_TUNNEL_USER} -j REJECT
done
`

function installScript(path: string, script: string): string {
  // Why base64: the build has no context directory to COPY from, and heredocs need BuildKit.
  return `RUN echo ${Buffer.from(script).toString('base64')} | base64 -d > ${path} && chmod 0755 ${path}`
}

export const SSH_VPN_DOCKERFILE = [
  `FROM ${ALPINE_BASE}`,
  `LABEL ${SSH_VPN_LABEL}=1`,
  'RUN apk add --no-cache openvpn iptables',
  `RUN adduser -D -H -s /sbin/nologin ${SSH_VPN_TUNNEL_USER}`,
  installScript(SSH_VPN_DNS_SCRIPT_PATH, DNS_SCRIPT),
  installScript(SSH_VPN_FIREWALL_SCRIPT_PATH, FIREWALL_SCRIPT),
  ''
].join('\n')

/** Changes whenever the Dockerfile does, so an updated Orca builds a fresh image. */
export const SSH_VPN_IMAGE = `orca-ssh-vpn:${createHash('sha256').update(SSH_VPN_DOCKERFILE).digest('hex').slice(0, 12)}`
