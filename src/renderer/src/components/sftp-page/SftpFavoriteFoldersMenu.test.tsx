// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../ui/tooltip'
import { SftpFavoriteFoldersMenu } from './SftpFavoriteFoldersMenu'
import { useSftpFavoriteFolders, type SftpFavoriteList } from './sftp-favorite-folders'
import { localFolderName } from './sftp-paths'

const onNavigate = vi.fn<(path: string) => void>()

let container: HTMLDivElement
let root: Root

const SHARED_ONLY: SftpFavoriteList[] = [{ scope: 'local', host: null }]
const HOST_AND_SHARED: SftpFavoriteList[] = [
  { scope: 'local:web', host: 'web-prod' },
  { scope: 'local', host: null }
]

async function render(
  path: string | null,
  lists: readonly SftpFavoriteList[] = SHARED_ONLY
): Promise<void> {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SftpFavoriteFoldersMenu
          lists={lists}
          path={path}
          folderName={localFolderName}
          onNavigate={onNavigate}
        />
      </TooltipProvider>
    )
  )
}

function press(element: Element | null): void {
  if (!element) {
    throw new Error('element not rendered')
  }
  act(() => {
    element.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    )
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    if (element instanceof HTMLElement) {
      element.click()
    }
  })
}

function openMenu(): void {
  press(container.querySelector('button[aria-label="Favorite folders"]'))
}

function menuItem(text: string, slot = 'dropdown-menu-item'): Element | null {
  return (
    [...document.querySelectorAll(`[data-slot="${slot}"]`)].find((item) =>
      item.textContent?.includes(text)
    ) ?? null
  )
}

function favorites(scope = 'local'): readonly string[] | undefined {
  return useSftpFavoriteFolders.getState().foldersByScope[scope]
}

beforeEach(() => {
  onNavigate.mockReset()
  window.localStorage.clear()
  useSftpFavoriteFolders.setState({ foldersByScope: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('SftpFavoriteFoldersMenu', () => {
  it('adds the folder shown to this list only', async () => {
    await render('/Users/dev/uploads')
    openMenu()

    expect(menuItem('No favorite folders yet')).not.toBeNull()
    press(menuItem('Add “uploads” to favorites'))

    expect(favorites()).toEqual(['/Users/dev/uploads'])
    expect(favorites('remote:web')).toBeUndefined()
  })

  it('goes to a favorite when it is picked', async () => {
    useSftpFavoriteFolders.setState({ foldersByScope: { local: ['/Users/dev/logs'] } })
    await render('/Users/dev')
    openMenu()

    press(document.querySelector('[data-sftp-favorite="/Users/dev/logs"]'))

    expect(onNavigate).toHaveBeenCalledWith('/Users/dev/logs')
  })

  it('removes the folder shown when it already is a favorite', async () => {
    useSftpFavoriteFolders.setState({ foldersByScope: { local: ['/Users/dev/uploads'] } })
    await render('/Users/dev/uploads')
    openMenu()

    press(menuItem('Remove “uploads” from favorites'))

    expect(favorites()).toEqual([])
  })

  it('removes any favorite from the remove submenu without going there', async () => {
    useSftpFavoriteFolders.setState({ foldersByScope: { local: ['/gone', '/Users/dev/logs'] } })
    await render('/Users/dev')
    openMenu()

    press(menuItem('Remove a favorite', 'dropdown-menu-sub-trigger'))
    const submenu = document.querySelector('[data-slot="dropdown-menu-sub-content"]')
    press(
      [...(submenu?.querySelectorAll('[data-slot="dropdown-menu-item"]') ?? [])].find(
        (item) => item.textContent === 'gone'
      ) ?? null
    )

    expect(favorites()).toEqual(['/Users/dev/logs'])
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('offers no add item before the pane has a folder', async () => {
    await render(null)
    openMenu()

    expect(menuItem('to favorites')).toBeNull()
    expect(menuItem('No favorite folders yet')).not.toBeNull()
  })

  describe('with a list for this connection and one for all connections', () => {
    it('adds the folder shown to the chosen list only', async () => {
      await render('/Users/dev/uploads', HOST_AND_SHARED)
      openMenu()

      expect(menuItem('Add “uploads” to favorites for all connections')).not.toBeNull()
      press(menuItem('Add “uploads” to favorites for web-prod'))

      expect(favorites('local:web')).toEqual(['/Users/dev/uploads'])
      expect(favorites('local')).toBeUndefined()
    })

    it('heads each list and goes to a favorite from either', async () => {
      useSftpFavoriteFolders.setState({
        foldersByScope: { 'local:web': ['/srv/deploy'], local: ['/Users/dev/Downloads'] }
      })
      await render('/Users/dev', HOST_AND_SHARED)
      openMenu()

      const headings = [...document.querySelectorAll('[data-slot="dropdown-menu-label"]')].map(
        (label) => label.textContent
      )
      expect(headings).toEqual(['web-prod only', 'All connections'])
      press(document.querySelector('[data-sftp-favorite-scope="local"]'))
      expect(onNavigate).toHaveBeenCalledWith('/Users/dev/Downloads')
    })

    it('fills the star and offers removal only from the list that has the folder', async () => {
      useSftpFavoriteFolders.setState({ foldersByScope: { local: ['/Users/dev/uploads'] } })
      await render('/Users/dev/uploads', HOST_AND_SHARED)

      expect(container.querySelector('svg[data-favorite="true"]')).not.toBeNull()
      openMenu()
      expect(menuItem('Add “uploads” to favorites for web-prod')).not.toBeNull()
      press(menuItem('Remove “uploads” from favorites for all connections'))

      expect(favorites('local')).toEqual([])
      expect(favorites('local:web')).toBeUndefined()
    })
  })
})
