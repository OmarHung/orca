// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { typeCdIntoTerminal, typePathsIntoTerminal } from './ssh-terminal-files-link'

const mocks = vi.hoisted(() => {
  const host: { platform?: string } = {}
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
  sendSshCommand: mocks.sendSshCommand,
  sshCommandRemotePlatform: () => mocks.host.platform
}))

beforeEach(() => {
  vi.clearAllMocks()
  delete mocks.host.platform
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

  it('copies the path instead on a Windows host', async () => {
    mocks.host.platform = 'win32'

    await typeCdIntoTerminal('tab', 'host', '/C:/Users/deploy')

    expect(mocks.sendSshCommand).not.toHaveBeenCalled()
    expect(mocks.writeClipboardText).toHaveBeenCalledWith('C:/Users/deploy')
  })
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
