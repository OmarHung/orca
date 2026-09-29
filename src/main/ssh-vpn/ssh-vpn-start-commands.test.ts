import { describe, expect, it } from 'vitest'
import { sshVpnStartCommands } from './ssh-vpn-start-commands'
import { SSH_VPN_IMAGE } from './ssh-vpn-image'

const PLAN = {
  dockerPath: '/usr/local/bin/docker',
  containerName: 'orca-ssh-vpn-tag-p',
  instanceTag: 'tag',
  profileId: 'p',
  ovpnPath: '/Users/o/Downloads/taipei.ovpn',
  files: [{ hostPath: '/Users/o/vpn/ca.crt', containerPath: '/run/orca/f0-ca.crt' }],
  buildsImage: false,
  writesLogin: false
}

describe('sshVpnStartCommands', () => {
  it('lists every docker command in the order the start runs them', () => {
    const commands = sshVpnStartCommands(PLAN)

    expect(commands).toEqual([
      "/usr/local/bin/docker info --format '{{.ServerVersion}}'",
      `/usr/local/bin/docker image inspect ${SSH_VPN_IMAGE}`,
      '/usr/local/bin/docker rm --force orca-ssh-vpn-tag-p',
      expect.stringMatching(
        /^\/usr\/local\/bin\/docker run --detach --rm --init --name orca-ssh-vpn-tag-p .* --cap-add NET_ADMIN --device \/dev\/net\/tun /
      ),
      '/usr/local/bin/docker exec orca-ssh-vpn-tag-p /usr/local/bin/orca-vpn-firewall',
      `/usr/local/bin/docker exec -i orca-ssh-vpn-tag-p sh -c 'umask 077 && base64 -d > "$1"' sh /run/orca/profile.ovpn   # stdin: /Users/o/Downloads/taipei.ovpn (paths rewritten for the container), base64`,
      `/usr/local/bin/docker exec -i orca-ssh-vpn-tag-p sh -c 'umask 077 && base64 -d > "$1"' sh /run/orca/f0-ca.crt   # stdin: /Users/o/vpn/ca.crt, base64`,
      '/usr/local/bin/docker exec orca-ssh-vpn-tag-p openvpn --config /run/orca/profile.ovpn --script-security 2 --up /usr/local/bin/orca-vpn-dns --verb 3'
    ])
  })

  it('writes the login and tells OpenVPN to read it, without showing it', () => {
    const commands = sshVpnStartCommands({ ...PLAN, writesLogin: true })

    expect(commands.at(-2)).toBe(
      `/usr/local/bin/docker exec -i orca-ssh-vpn-tag-p sh -c 'umask 077 && base64 -d > "$1"' sh /run/orca/login   # stdin: your VPN username and password (not shown), base64`
    )
    expect(commands.at(-1)).toContain(' --auth-user-pass /run/orca/login --auth-nocache ')
  })

  it('adds the image build only when the image is missing', () => {
    const commands = sshVpnStartCommands({ ...PLAN, buildsImage: true })

    expect(commands[2]).toBe(
      `/usr/local/bin/docker build --tag ${SSH_VPN_IMAGE} -   # stdin: Orca's Dockerfile`
    )
  })
})
