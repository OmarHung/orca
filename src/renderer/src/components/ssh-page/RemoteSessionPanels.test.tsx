// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { TooltipProvider } from '../ui/tooltip'
import { useRemoteSessionStore } from './remote-session-store'
import { useSshSessionLivenessStore } from './ssh-session-liveness'
import { RemoteSessionPanels } from './RemoteSessionPanels'

const mocks = vi.hoisted(() => ({
  closeTerminalTab: vi.fn(),
  clearTabPtyId: vi.fn()
}))

vi.mock('@/components/terminal-pane/TerminalPane', () => ({
  default: ({
    tabId,
    isActive,
    isVisible,
    onPtyExit
  }: {
    tabId: string
    isActive: boolean
    isVisible: boolean
    onPtyExit: (ptyId: string, exitCode: number) => void
  }) => (
    <button
      data-terminal={tabId}
      data-terminal-active={String(isActive)}
      data-terminal-visible={String(isVisible)}
      onClick={() => onPtyExit('pty-1', 0)}
    />
  )
}))
vi.mock('@/components/terminal-pane/parking/output-watchers/terminal-parked-tab-watchers', () => ({
  shouldDeferParkedPtyExitTabClose: () => false
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({
  closeTerminalTab: mocks.closeTerminalTab
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ clearTabPtyId: mocks.clearTabPtyId }) }
}))
vi.mock('./ssh-session-actions', () => ({ closeSshSession: vi.fn() }))
vi.mock('./use-ssh-session-cwd', () => ({ useSshSessionCwd: () => '/home/dev' }))
vi.mock('../sftp-page/SftpWorkbench', () => ({
  SftpWorkbench: ({ target, isActive }: { target: SshTarget; isActive: boolean }) => (
    <div data-workbench={target.id} data-workbench-active={String(isActive)} />
  )
}))

const web: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}
const targetsById = new Map([[web.id, web]])

let container: HTMLDivElement
let root: Root
const onStartTerminal = vi.fn()
const onReconnect = vi.fn()

async function render(tabIds: string[], activeTerminalId: string | null): Promise<void> {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <RemoteSessionPanels
          isVisible
          items={{
            tabs: tabIds.map((id) => ({ id, ptyId: `pty-${id}`, createdAt: 0 })),
            terminalItems: tabIds.map((id) => ({ id, quickCommandLabel: `label-${id}` })),
            activeTerminalId,
            parkedTerminalTabIds: new Set<string>()
          }}
          targetsById={targetsById}
          targetsStatus="ready"
          onStartTerminal={onStartTerminal}
          onReconnect={onReconnect}
          onAddCurrentToGrid={vi.fn()}
          onReturnToGrid={vi.fn()}
          onJoinSync={vi.fn()}
        />
      </TooltipProvider>
    )
  )
}

function terminals(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-terminal]')].map(
    (node) =>
      `${node.dataset.terminal}:${node.dataset.terminalActive}:${node.dataset.terminalVisible}`
  )
}

function workbenches(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-workbench]')].map(
    (node) => `${node.dataset.workbench}:${node.dataset.workbenchActive}`
  )
}

function terminalArea(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-remote-terminals]')
}

function filesArea(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-remote-files]')
}

const getForegroundProcess = vi.fn(async (): Promise<string | null> => 'ssh')

function addSession(
  tabId: string,
  layout: 'terminal' | 'split' | 'files',
  terminalStarted: boolean
): void {
  useRemoteSessionStore.getState().addSession({ tabId, targetId: web.id, layout, terminalStarted })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  useRemoteSessionStore.setState({ sessions: {}, remotePathByTab: {} })
  useSshSessionLivenessStore.setState({ byTab: {} })
  getForegroundProcess.mockResolvedValue('ssh')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      pty: { getForegroundProcess },
      sftp: { localHostname: async () => 'my-laptop' }
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('RemoteSessionPanels', () => {
  it('asks for a host when nothing is open', async () => {
    await render([], null)

    expect(container.textContent).toContain('Pick a host to open an SSH session.')
    expect(filesArea()?.classList.contains('hidden')).toBe(true)
  })

  it('opens no file connection while a tab only shows its terminal', async () => {
    addSession('a', 'terminal', true)

    await render(['a'], 'a')

    expect(terminals()).toEqual(['a:true:true'])
    expect(workbenches()).toEqual([])
    expect(filesArea()?.classList.contains('hidden')).toBe(true)
  })

  it('starts no terminal while a tab only shows files', async () => {
    addSession('a', 'files', false)

    await render(['a'], 'a')

    expect(terminals()).toEqual([])
    expect(workbenches()).toEqual(['web:true'])
    expect(terminalArea()?.classList.contains('hidden')).toBe(true)
  })

  it('shows both halves in the split layout', async () => {
    addSession('a', 'split', true)

    await render(['a'], 'a')

    expect(terminals()).toEqual(['a:true:true'])
    expect(workbenches()).toEqual(['web:true'])
    expect(terminalArea()?.classList.contains('hidden')).toBe(false)
    expect(filesArea()?.classList.contains('hidden')).toBe(false)
  })

  it('keeps a running terminal mounted but inactive while its tab shows files', async () => {
    addSession('a', 'files', true)

    await render(['a'], 'a')

    expect(terminals()).toEqual(['a:false:false'])
  })

  it('keeps the file workbench mounted but inactive after going back to the terminal', async () => {
    addSession('a', 'split', true)
    await render(['a'], 'a')

    await act(async () => useRemoteSessionStore.getState().setLayout('a', 'terminal'))

    expect(workbenches()).toEqual(['web:false'])
    expect(filesArea()?.classList.contains('hidden')).toBe(true)
  })

  it('offers to connect when a files tab switches to its terminal, without connecting', async () => {
    addSession('a', 'files', false)
    await render(['a'], 'a')

    await act(async () => useRemoteSessionStore.getState().setLayout('a', 'terminal'))

    expect(terminals()).toEqual([])
    const connect = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Connect to web-prod')
    )
    expect(connect).toBeDefined()
    expect(onStartTerminal).not.toHaveBeenCalled()

    await act(async () => connect?.click())

    expect(onStartTerminal).toHaveBeenCalledWith('a', web)
  })

  describe('the session-ended banner', () => {
    function banner(): Element | null {
      return container.querySelector('[data-ssh-session-ended]')
    }

    async function endSession(foreground = 'zsh'): Promise<void> {
      getForegroundProcess.mockResolvedValue(foreground)
      await act(async () => {
        useSshSessionLivenessStore.getState().recordForeground('a', 'ssh', 1)
        useSshSessionLivenessStore.getState().recordForeground('a', foreground, 2)
      })
    }

    it('stays away while ssh runs', async () => {
      addSession('a', 'terminal', true)

      await render(['a'], 'a')

      expect(banner()).toBeNull()
    })

    it('says the tab is now a local shell, and reconnects in place', async () => {
      addSession('a', 'terminal', true)
      await render(['a'], 'a')

      await endSession()

      expect(banner()?.textContent).toContain('This tab is now a local shell, not web-prod.')
      const reconnect = banner()?.querySelector('button')
      await act(async () => reconnect?.click())
      expect(onReconnect).toHaveBeenCalledWith('a', web)
    })

    it('refuses to reconnect while a local program would read the command', async () => {
      addSession('a', 'terminal', true)
      await render(['a'], 'a')

      await endSession('vim')

      expect(banner()?.querySelector('button')?.disabled).toBe(true)
      expect(banner()?.textContent).toContain(
        'Something still seems to be running in this tab. Finish it first.'
      )
    })

    it('draws no conclusion when the foreground cannot be read', async () => {
      addSession('a', 'terminal', true)
      getForegroundProcess.mockResolvedValue(null)

      await render(['a'], 'a')

      expect(banner()).toBeNull()
    })

    it('does not apply to a tab whose terminal never started', async () => {
      addSession('a', 'terminal', false)
      await render(['a'], 'a')
      await act(async () => useSshSessionLivenessStore.getState().recordForeground('a', 'zsh', 1))
      await act(async () =>
        useSshSessionLivenessStore.getState().recordForeground('a', 'zsh', 100_000)
      )

      expect(banner()).toBeNull()
    })
  })

  describe('when the terminal’s shell ends', () => {
    async function endShell(): Promise<void> {
      await act(async () => container.querySelector<HTMLElement>('[data-terminal="a"]')?.click())
    }

    it('closes a tab that only ever showed its terminal', async () => {
      addSession('a', 'terminal', true)
      await render(['a'], 'a')

      await endShell()

      expect(mocks.closeTerminalTab).toHaveBeenCalledWith('a', {
        reason: 'pty-exit',
        lifecyclePtyId: 'pty-1'
      })
    })

    it('keeps a tab showing files, and offers to connect again', async () => {
      addSession('a', 'split', true)
      await render(['a'], 'a')

      await endShell()

      expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
      expect(mocks.clearTabPtyId).toHaveBeenCalledWith('a', 'pty-1')
      expect(terminals()).toEqual([])
      expect(workbenches()).toEqual(['web:true'])
      expect(container.textContent).toContain('Connect to web-prod')
    })

    it('keeps a tab that showed files earlier, even if it now shows only its terminal', async () => {
      addSession('a', 'terminal', true)
      useRemoteSessionStore.getState().setRemotePath('a', '/srv')
      await render(['a'], 'a')

      await endShell()

      expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
      expect(useRemoteSessionStore.getState().sessions.a.terminalStarted).toBe(false)
    })
  })

  it('keeps each tab’s own layout when switching tabs', async () => {
    addSession('a', 'files', false)
    addSession('b', 'terminal', true)
    await render(['a', 'b'], 'a')
    expect(terminalArea()?.classList.contains('hidden')).toBe(true)

    await render(['a', 'b'], 'b')

    expect(terminalArea()?.classList.contains('hidden')).toBe(false)
    expect(filesArea()?.classList.contains('hidden')).toBe(true)
    expect(terminals()).toEqual(['b:true:true'])
  })

  it('applies a dragged height only on release, so the terminal resizes once', async () => {
    addSession('a', 'split', true)
    await render(['a'], 'a')
    const handle = container.querySelector<HTMLElement>('[role="separator"]')
    const area = filesArea()
    const page = area?.parentElement
    if (page) {
      Object.defineProperty(page, 'clientHeight', { configurable: true, value: 800 })
    }
    const before = area?.style.height
    expect(before).toBe('280px')

    await act(async () => {
      handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 500 }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 440 }))
    })

    expect(area?.style.height).toBe(before)
    expect(container.querySelector('[data-remote-dock-guide]')).not.toBeNull()

    await act(async () => window.dispatchEvent(new PointerEvent('pointerup')))

    expect(container.querySelector('[data-remote-dock-guide]')).toBeNull()
    expect(area?.style.height).toBe('340px')
    expect(useRemoteSessionStore.getState().sessions.a.dockHeight).toBe(340)
  })
})
