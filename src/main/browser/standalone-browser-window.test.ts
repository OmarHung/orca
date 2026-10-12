import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

const { mocks } = vi.hoisted(() => {
  type FakeContents = {
    isDestroyed: () => boolean
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    navigationHistory: {
      canGoBack: () => boolean
      canGoForward: () => boolean
      goBack: ReturnType<typeof vi.fn>
      goForward: ReturnType<typeof vi.fn>
    }
    handlers: Map<string, Handler>
  }
  type FakePopup = {
    window: { id: number }
    contentWebContents: FakeContents
    close: () => void
    onClosed: (listener: () => void) => void
    closeListeners: (() => void)[]
    options: Record<string, unknown>
    url: string
  }
  const popups: FakePopup[] = []
  const createContents = (): FakeContents => {
    const handlers = new Map<string, Handler>()
    return {
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
      reload: vi.fn(),
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => true,
        goBack: vi.fn(),
        goForward: vi.fn()
      },
      handlers
    }
  }
  const openPopupWithOriginBar = vi.fn(
    (
      options: Record<string, unknown>,
      url: string,
      prepare?: (contents: FakeContents) => boolean
    ): FakePopup => {
      const contents = createContents()
      prepare?.(contents)
      const closeListeners: (() => void)[] = []
      const popup: FakePopup = {
        window: { id: popups.length + 1 },
        contentWebContents: contents,
        close: vi.fn(() => {
          for (const listener of closeListeners.splice(0)) {
            listener()
          }
        }),
        onClosed: (listener) => closeListeners.push(listener),
        closeListeners,
        options,
        url
      }
      popups.push(popup)
      return popup
    }
  )
  return { mocks: { popups, openPopupWithOriginBar, show: vi.fn() } }
})

vi.mock('./popup-origin-bar-window', () => ({
  openPopupWithOriginBar: mocks.openPopupWithOriginBar
}))
vi.mock('../window/foreground-activation-policy', () => ({
  showWindowWithoutStealingFocus: mocks.show
}))

import {
  openStandaloneBrowserWindow,
  resolveStandaloneBrowserChord
} from './standalone-browser-window'

const PARTITION = 'persist:orca-browser'

type OpenDetails = { url: string; frameName: string; features: string; disposition: string }

function windowOpenHandler(
  index = 0
): (details: OpenDetails) => Electron.WindowOpenHandlerResponse {
  const handler = mocks.popups[index]?.contentWebContents.setWindowOpenHandler.mock.calls[0]?.[0]
  if (!handler) {
    throw new Error('no window open handler installed')
  }
  return handler
}

function details(overrides: Partial<OpenDetails>): OpenDetails {
  return {
    url: 'https://example.org/',
    frameName: '',
    features: '',
    disposition: 'foreground-tab',
    ...overrides
  }
}

beforeEach(() => {
  for (const popup of mocks.popups.splice(0)) {
    popup.close()
  }
  mocks.openPopupWithOriginBar.mockClear()
  mocks.show.mockClear()
})

describe('openStandaloneBrowserWindow', () => {
  it('opens the page hidden in the given profile, then presents it without stealing focus', () => {
    expect(openStandaloneBrowserWindow('https://acme.monday.com/boards/1', PARTITION)).toBe(
      true
    )
    const popup = mocks.popups[0]
    expect(popup.url).toBe('https://acme.monday.com/boards/1')
    expect(popup.options).toMatchObject({
      show: false,
      width: 1280,
      height: 860,
      webPreferences: { partition: PARTITION, sandbox: true, nodeIntegration: false }
    })
    expect(mocks.show).toHaveBeenCalledWith(popup.window)
  })

  it('refuses anything that is not a web address', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      expect(openStandaloneBrowserWindow(url, PARTITION)).toBe(false)
    }
    expect(mocks.openPopupWithOriginBar).not.toHaveBeenCalled()
  })
})

describe('window.open from a standalone window', () => {
  it('turns a new-tab open into another full window and denies the in-page handle', () => {
    openStandaloneBrowserWindow('https://example.org/', PARTITION)
    const result = windowOpenHandler()(details({ url: 'https://docs.example.org/' }))
    expect(result).toEqual({ action: 'deny' })
    expect(mocks.popups[1]?.url).toBe('https://docs.example.org/')
    expect(mocks.popups[1]?.options).toMatchObject({ width: 1280, height: 860 })
  })

  it('keeps an OAuth-style popup as a child that adopts Electron contents in the same profile', () => {
    openStandaloneBrowserWindow('https://example.org/', PARTITION)
    const result = windowOpenHandler()(
      details({
        url: 'https://accounts.example.org/auth',
        frameName: 'oauth',
        features: 'width=500,height=600',
        disposition: 'new-window'
      })
    )
    if (result.action !== 'allow' || !result.createWindow) {
      throw new Error('expected the popup to be allowed as a child window')
    }
    expect(result.overrideBrowserWindowOptions?.webPreferences?.partition).toBe(PARTITION)
    const created = result.createWindow({ width: 500, height: 600 })
    expect(created).toBe(mocks.popups[1]?.contentWebContents)
    expect(mocks.popups[1]?.options).toMatchObject({ show: false, width: 500, height: 600 })
  })

  it('denies opens that are not web pages', () => {
    openStandaloneBrowserWindow('https://example.org/', PARTITION)
    expect(windowOpenHandler()(details({ url: 'file:///etc/passwd' }))).toEqual({
      action: 'deny'
    })
    expect(mocks.popups).toHaveLength(1)
  })

  it('stops opening windows once too many are open', () => {
    openStandaloneBrowserWindow('https://example.org/', PARTITION)
    const handler = windowOpenHandler()
    for (let index = 0; index < 20; index += 1) {
      handler(details({ url: `https://example.org/${index}` }))
    }
    expect(mocks.popups).toHaveLength(12)
  })
})

describe('resolveStandaloneBrowserChord', () => {
  type ChordInput = Parameters<typeof resolveStandaloneBrowserChord>[0]
  const key = (input: Partial<ChordInput>): ChordInput => ({
    type: 'keyDown',
    key: '',
    meta: false,
    control: false,
    alt: false,
    ...input
  })

  it('uses Cmd on macOS and Ctrl elsewhere', () => {
    expect(resolveStandaloneBrowserChord(key({ key: 'r', meta: true }), 'darwin')).toBe('reload')
    expect(resolveStandaloneBrowserChord(key({ key: 'r', control: true }), 'darwin')).toBeNull()
    expect(resolveStandaloneBrowserChord(key({ key: 'w', control: true }), 'win32')).toBe('close')
    expect(resolveStandaloneBrowserChord(key({ key: 'w', meta: true }), 'linux')).toBeNull()
  })

  it('maps each platform history chord', () => {
    expect(resolveStandaloneBrowserChord(key({ key: '[', meta: true }), 'darwin')).toBe('back')
    expect(resolveStandaloneBrowserChord(key({ key: ']', meta: true }), 'darwin')).toBe('forward')
    expect(resolveStandaloneBrowserChord(key({ key: 'ArrowLeft', alt: true }), 'linux')).toBe(
      'back'
    )
    expect(resolveStandaloneBrowserChord(key({ key: 'ArrowRight', alt: true }), 'win32')).toBe(
      'forward'
    )
  })

  it('ignores key releases and plain typing', () => {
    expect(
      resolveStandaloneBrowserChord(key({ type: 'keyUp', key: 'r', meta: true }), 'darwin')
    ).toBeNull()
    expect(resolveStandaloneBrowserChord(key({ key: 'r' }), 'darwin')).toBeNull()
  })

  it('reloads the window it was pressed in', () => {
    openStandaloneBrowserWindow('https://example.org/', PARTITION)
    const contents = mocks.popups[0].contentWebContents
    const preventDefault = vi.fn()
    const isMac = process.platform === 'darwin'
    contents.handlers.get('before-input-event')?.(
      { preventDefault },
      key({ key: 'r', meta: isMac, control: !isMac })
    )
    expect(preventDefault).toHaveBeenCalled()
    expect(contents.reload).toHaveBeenCalled()
  })
})
