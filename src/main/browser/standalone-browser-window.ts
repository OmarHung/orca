import { ORCA_BROWSER_BLANK_URL } from '../../shared/constants'
import {
  normalizeBrowserNavigationUrl,
  normalizeExternalBrowserUrl
} from '../../shared/browser-url'
import { showWindowWithoutStealingFocus } from '../window/foreground-activation-policy'
import { SAFE_POPUP_WINDOW_OPTIONS } from './browser-manager-types'
import { isNewBrowserTabPopupIntent } from './browser-popup-new-tab-intent'
import {
  openPopupWithOriginBar,
  type PopupChildWindowOptions,
  type PopupOriginBarWindow
} from './popup-origin-bar-window'

const STANDALONE_WINDOW_WIDTH = 1280
const STANDALONE_WINDOW_HEIGHT = 860
/** Bounded so a page holding a gesture stream cannot paper the desktop in windows. */
const MAX_STANDALONE_WINDOWS = 12

export type StandaloneBrowserChord = 'reload' | 'back' | 'forward' | 'close'

const openWindows = new Set<PopupOriginBarWindow>()

/** The window has no Orca renderer to route keys through, so it answers the basic browser chords itself. */
export function resolveStandaloneBrowserChord(
  input: Pick<Electron.Input, 'type' | 'key' | 'meta' | 'control' | 'alt'>,
  platform: NodeJS.Platform
): StandaloneBrowserChord | null {
  if (input.type !== 'keyDown') {
    return null
  }
  const isMac = platform === 'darwin'
  const key = input.key.toLowerCase()
  const primary = isMac ? input.meta && !input.control : input.control && !input.meta
  if (primary && !input.alt) {
    if (key === 'r') {
      return 'reload'
    }
    if (key === 'w') {
      return 'close'
    }
    if (isMac && key === '[') {
      return 'back'
    }
    if (isMac && key === ']') {
      return 'forward'
    }
  }
  if (!isMac && input.alt && !input.control && !input.meta) {
    if (key === 'arrowleft') {
      return 'back'
    }
    if (key === 'arrowright') {
      return 'forward'
    }
  }
  return null
}

function windowOptions(partition: string): PopupChildWindowOptions {
  return {
    ...SAFE_POPUP_WINDOW_OPTIONS,
    webPreferences: { ...SAFE_POPUP_WINDOW_OPTIONS.webPreferences, partition }
  }
}

function fullWindowOptions(partition: string): PopupChildWindowOptions {
  return {
    ...windowOptions(partition),
    // Why: no page is handed over on this path; the popup loads the URL itself.
    loadInitialUrl: true,
    width: STANDALONE_WINDOW_WIDTH,
    height: STANDALONE_WINDOW_HEIGHT
  }
}

function installChords(popup: PopupOriginBarWindow): void {
  const contents = popup.contentWebContents
  if (contents.isDestroyed()) {
    return
  }
  contents.on('before-input-event', (event, input) => {
    const chord = resolveStandaloneBrowserChord(input, process.platform)
    if (!chord) {
      return
    }
    event.preventDefault()
    if (chord === 'close') {
      popup.close()
    } else if (chord === 'reload') {
      contents.reload()
    } else if (chord === 'back' && contents.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack()
    } else if (chord === 'forward' && contents.navigationHistory.canGoForward()) {
      contents.navigationHistory.goForward()
    }
  })
}

function routeWindowOpen(
  details: Electron.HandlerDetails,
  partition: string
): Electron.WindowOpenHandlerResponse {
  const externalUrl = normalizeExternalBrowserUrl(details.url)
  const isBlank = normalizeBrowserNavigationUrl(details.url) === ORCA_BROWSER_BLANK_URL
  if ((!externalUrl && !isBlank) || openWindows.size >= MAX_STANDALONE_WINDOWS) {
    return { action: 'deny' }
  }
  // Why: this surface has no tabs, so a new-tab open (target=_blank, Cmd-click) gets a full window.
  if (externalUrl && isNewBrowserTabPopupIntent(details)) {
    openWindow(fullWindowOptions(partition), externalUrl, partition)
    return { action: 'deny' }
  }
  return {
    action: 'allow',
    overrideBrowserWindowOptions: windowOptions(partition),
    // Why adopt Electron's contents: window.opener survives, which OAuth/SSO popups report back through.
    createWindow: (options: PopupChildWindowOptions) =>
      openWindow(options, details.url, partition).contentWebContents
  }
}

function openWindow(
  options: PopupChildWindowOptions,
  url: string,
  partition: string
): PopupOriginBarWindow {
  const popup = openPopupWithOriginBar({ ...options, show: false }, url, (contents) => {
    contents.setWindowOpenHandler((details) => routeWindowOpen(details, partition))
    return true
  })
  openWindows.add(popup)
  popup.onClosed(() => openWindows.delete(popup))
  installChords(popup)
  showWindowWithoutStealingFocus(popup.window)
  return popup
}

/**
 * Opens a web page in a top-level window of its own, under Orca's origin bar. It belongs to no
 * workspace surface, so nothing can fold it into a panel. The partition carries the login.
 */
export function openStandaloneBrowserWindow(url: string, partition: string): boolean {
  const target = normalizeExternalBrowserUrl(url)
  if (!target) {
    return false
  }
  openWindow(fullWindowOptions(partition), target, partition)
  return true
}
