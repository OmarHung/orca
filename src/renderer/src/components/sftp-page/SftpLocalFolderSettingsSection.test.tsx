// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SftpLocalFolderSettingsSection } from './SftpLocalFolderSettingsSection'
import { useSftpDefaultLocalFolder } from './sftp-local-folder-memory'

const pickDirectory = vi.fn<(args: { defaultPath?: string }) => Promise<string | null>>()

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  pickDirectory.mockReset()
  window.localStorage.clear()
  useSftpDefaultLocalFolder.setState({ defaultFolder: null })
  Reflect.set(window, 'api', { shell: { pickDirectory } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<SftpLocalFolderSettingsSection />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'api')
})

function button(name: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
}

function shownFolder(): string {
  return container.querySelector('input')?.value ?? ''
}

describe('SftpLocalFolderSettingsSection', () => {
  it('saves the picked folder as the default for every host', async () => {
    pickDirectory.mockResolvedValue('/Users/dev/transfers')

    await act(async () => button('Choose default local folder')?.click())

    expect(useSftpDefaultLocalFolder.getState().defaultFolder).toBe('/Users/dev/transfers')
    expect(shownFolder()).toBe('/Users/dev/transfers')
    expect(window.localStorage.getItem('orca.sftpDefaultLocalFolder')).toBe('/Users/dev/transfers')
  })

  it('keeps the current default when the picker is cancelled', async () => {
    await act(async () => useSftpDefaultLocalFolder.getState().setDefaultFolder('/Users/dev/keep'))
    pickDirectory.mockResolvedValue(null)

    await act(async () => button('Choose default local folder')?.click())

    expect(pickDirectory).toHaveBeenCalledWith({ defaultPath: '/Users/dev/keep' })
    expect(useSftpDefaultLocalFolder.getState().defaultFolder).toBe('/Users/dev/keep')
  })

  it('goes back to the home folder when cleared', async () => {
    await act(async () => useSftpDefaultLocalFolder.getState().setDefaultFolder('/Users/dev/x'))

    await act(async () => button('Use the home folder')?.click())

    expect(useSftpDefaultLocalFolder.getState().defaultFolder).toBeNull()
    expect(window.localStorage.getItem('orca.sftpDefaultLocalFolder')).toBeNull()
    expect(button('Use the home folder')).toBeNull()
  })
})
