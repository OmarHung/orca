// @vitest-environment happy-dom

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  quotePathForAnyShell,
  typeCdIntoTerminal,
  typePathsIntoTerminal
} from './ssh-terminal-files-link'

const mocks = vi.hoisted(() => {
  const host: { platform?: string; doubt: string | null } = { doubt: null }
  return {
    host,
    sendSshCommand: vi.fn(async () => true),
    writeClipboardText: vi.fn(async () => undefined),
    toastError: vi.fn(),
    toastInfo: vi.fn()
  }
})

vi.mock('sonner', () => ({ toast: { error: mocks.toastError, info: mocks.toastInfo } }))
vi.mock('../ssh-commands/ssh-command-send', () => ({
  checkSshCommandTarget: async () => ({ kind: 'ready', ptyId: 'pty', doubt: mocks.host.doubt }),
  sendSshCommand: mocks.sendSshCommand,
  sshCommandRemotePlatform: () => mocks.host.platform
}))

beforeEach(() => {
  vi.clearAllMocks()
  delete mocks.host.platform
  mocks.host.doubt = null
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { writeClipboardText: mocks.writeClipboardText } }
  })
})

describe('typeCdIntoTerminal', () => {
  it('types the cd without pressing Enter', async () => {
    await typeCdIntoTerminal('tab', 'host', '/var/www/app')

    expect(mocks.sendSshCommand).toHaveBeenCalledWith('tab', "cd -- '/var/www/app'", 'insert')
  })

  it('keeps a folder name as one word, whatever it holds', async () => {
    await typeCdIntoTerminal('tab', 'host', "/srv/it's; rm -rf $HOME")

    expect(mocks.sendSshCommand).toHaveBeenCalledWith(
      'tab',
      "cd -- '/srv/it'\\''s; rm -rf $HOME'",
      'insert'
    )
  })

  it.each(['/srv/x\ntouch pwn\n', '/srv/x\u0015touch pwn', '/srv/x\u001b[A'])(
    'refuses a name with control characters: %j',
    async (path) => {
      await typeCdIntoTerminal('tab', 'host', path)

      expect(mocks.sendSshCommand).not.toHaveBeenCalled()
      expect(mocks.toastError).toHaveBeenCalled()
    }
  )

  it.each(['noSshEvidence', 'manualSsh'])(
    'copies the path instead when in doubt about where the terminal is: %s',
    async (doubt) => {
      mocks.host.doubt = doubt

      await typeCdIntoTerminal('tab', 'host', "/srv/x&calc&'")

      expect(mocks.sendSshCommand).not.toHaveBeenCalled()
      expect(mocks.writeClipboardText).toHaveBeenCalledWith("/srv/x&calc&'")
    }
  )

  it('copies the path instead on a Windows host', async () => {
    mocks.host.platform = 'win32'

    await typeCdIntoTerminal('tab', 'host', '/C:/Users/deploy')

    expect(mocks.sendSshCommand).not.toHaveBeenCalled()
    expect(mocks.writeClipboardText).toHaveBeenCalledWith('C:/Users/deploy')
  })
})

describe('quotePathForAnyShell', () => {
  const NAMES = [
    '/var/www/app',
    '/srv/my folder',
    "/srv/it's",
    "/srv/a\\'; touch /tmp/pwned #",
    '/srv/ends-with\\',
    '/srv/a\\\\b',
    '/srv/$HOME `id` $(id) "x" *',
    "'''",
    '\\'
  ]

  it('keeps every backslash and apostrophe outside the quotes, where fish reads them as sh does', () => {
    expect(quotePathForAnyShell("a\\'; touch #")).toBe("'a'\\\\\\''; touch #'")
  })

  it.each(['/bin/sh', '/bin/bash', '/bin/zsh', '/opt/homebrew/bin/fish', '/usr/bin/fish'])(
    'comes back unchanged through %s',
    (shell) => {
      if (!existsSync(shell)) {
        return
      }
      for (const name of NAMES) {
        const output = execFileSync(shell, ['-c', `printf %s ${quotePathForAnyShell(name)}`], {
          encoding: 'utf8'
        })
        expect(output).toBe(name)
      }
    }
  )
})

describe('typePathsIntoTerminal', () => {
  it('types each path quoted with a space after, and no Enter', async () => {
    await typePathsIntoTerminal('tab', 'host', ['/srv/a b', '/srv/c'])

    expect(mocks.sendSshCommand).toHaveBeenCalledWith('tab', "'/srv/a b' '/srv/c' ", 'insert')
  })

  it('types none of them if any has control characters', async () => {
    await typePathsIntoTerminal('tab', 'host', ['/srv/fine', '/srv/x\rdeploy'])

    expect(mocks.sendSshCommand).not.toHaveBeenCalled()
  })
})
