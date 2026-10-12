import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

type FakeWebContents = {
  mainFrame: { url: string; origin: string }
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  executeJavaScript: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
}

const { fakeElectron } = vi.hoisted(() => {
  function createFakeWebContents(): FakeWebContents {
    const handlers = new Map<string, Handler[]>()
    let destroyed = false
    const add = (event: string, handler: Handler): void => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    }
    const mainFrame = { url: '', origin: '' }
    return {
      mainFrame,
      on: vi.fn(add),
      once: vi.fn(add),
      off: vi.fn((event: string, handler: Handler) => {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler)
        )
      }),
      executeJavaScript: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      // Electron marks contents destroyed before emitting destroyed; the close guard depends on this.
      isDestroyed: vi.fn(() => destroyed),
      emit: (event: string, ...args: unknown[]) => {
        if (event === 'did-navigate' || (event === 'did-navigate-in-page' && args[2])) {
          mainFrame.url = String(args[1])
        }
        if (event === 'destroyed') {
          destroyed = true
        }
        for (const handler of handlers.get(event) ?? []) {
          handler(...args)
        }
      }
    }
  }

  class FakeWebContentsView {
    static instances: FakeWebContentsView[] = []
    options: { webContents?: FakeWebContents; webPreferences?: unknown }
    webContents: FakeWebContents
    setBounds = vi.fn()
    constructor(options: { webContents?: FakeWebContents; webPreferences?: unknown }) {
      // Electron rejects explicitly undefined webContents.
      if (Object.hasOwn(options, 'webContents') && options.webContents === undefined) {
        throw new TypeError('options.webContents must be a WebContents')
      }
      this.options = options
      this.webContents = options.webContents ?? createFakeWebContents()
      FakeWebContentsView.instances.push(this)
    }
  }

  class FakeContentView {
    private handlers = new Map<string, Handler[]>()
    addChildView = vi.fn()
    on(event: string, handler: Handler): void {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }
    emit(event: string): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler()
      }
    }
  }

  class FakeBaseWindow {
    static instances: FakeBaseWindow[] = []
    options: Record<string, unknown>
    private handlers = new Map<string, Handler[]>()
    contentView = new FakeContentView()
    contentSize: { width: number; height: number }
    setTitle = vi.fn()
    isDestroyed = vi.fn(() => false)
    close = vi.fn(() => this.emit('closed'))
    constructor(options: Record<string, unknown>) {
      this.options = options
      this.contentSize = { width: Number(options.width), height: Number(options.height) }
      FakeBaseWindow.instances.push(this)
    }
    on(event: string, handler: Handler): void {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    }
    once(event: string, handler: Handler): void {
      this.on(event, handler)
    }
    getContentBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, ...this.contentSize }
    }
    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args)
      }
    }
  }

  return {
    fakeElectron: { createFakeWebContents, FakeWebContentsView, FakeBaseWindow }
  }
})

vi.mock('electron', () => ({
  BaseWindow: fakeElectron.FakeBaseWindow,
  WebContentsView: fakeElectron.FakeWebContentsView
}))

import { openPopupWithOriginBar } from './popup-origin-bar-window'

const { FakeWebContentsView, FakeBaseWindow } = fakeElectron

function lastWindow(): InstanceType<typeof FakeBaseWindow> {
  const instance = FakeBaseWindow.instances.at(-1)
  if (!instance) {
    throw new Error('no BaseWindow was constructed')
  }
  return instance
}

beforeEach(() => {
  FakeBaseWindow.instances = []
  FakeWebContentsView.instances = []
})
afterEach(() => vi.unstubAllEnvs())

describe('openPopupWithOriginBar', () => {
  it('shows guest popups at once but leaves a caller-presented window hidden', () => {
    vi.stubEnv('ORCA_BACKGROUND_LAUNCH', undefined)
    openPopupWithOriginBar({ loadInitialUrl: true }, 'https://a.example/')
    expect(lastWindow().options.show).toBe(true)

    const popup = openPopupWithOriginBar(
      { loadInitialUrl: true, show: false },
      'https://b.example/'
    )
    expect(lastWindow().options.show).toBe(false)
    expect(popup.window).toBe(lastWindow())
  })
})
