import { createHash } from 'node:crypto'

export const SSH_VPN_LABEL = 'dev.orca.ssh-vpn'
export const SSH_VPN_DNS_SCRIPT_PATH = '/usr/local/bin/orca-vpn-dns'

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

export const SSH_VPN_DOCKERFILE = [
  `FROM ${ALPINE_BASE}`,
  `LABEL ${SSH_VPN_LABEL}=1`,
  'RUN apk add --no-cache openvpn',
  // Why base64: the build has no context directory to COPY from, and heredocs need BuildKit.
  `RUN echo ${Buffer.from(DNS_SCRIPT).toString('base64')} | base64 -d > ${SSH_VPN_DNS_SCRIPT_PATH} && chmod 0755 ${SSH_VPN_DNS_SCRIPT_PATH}`,
  ''
].join('\n')

/** Changes whenever the Dockerfile does, so an updated Orca builds a fresh image. */
export const SSH_VPN_IMAGE = `orca-ssh-vpn:${createHash('sha256').update(SSH_VPN_DOCKERFILE).digest('hex').slice(0, 12)}`
