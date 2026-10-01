import { describe, expect, it } from 'vitest'
import { outputFolderEmptyingProblem } from './output-folder-safety'

const PROTECT = { workspaceRoot: '/Users/me/src/app', contextDir: '/Users/me/src/app' }

describe('outputFolderEmptyingProblem', () => {
  it('allows a folder of its own, inside or outside the workspace', () => {
    expect(outputFolderEmptyingProblem('/Users/me/deploy/web', PROTECT)).toBeNull()
    expect(outputFolderEmptyingProblem('/Users/me/src/app/publish', PROTECT)).toBeNull()
    expect(
      outputFolderEmptyingProblem('/Volumes/WD SN7100/Autron/Publish location/web', PROTECT)
    ).toBeNull()
    expect(outputFolderEmptyingProblem('D:\\deploy\\web', PROTECT)).toBeNull()
  })

  it('refuses roots, top-level, home and system folders', () => {
    for (const folder of [
      '/',
      '/srv',
      '/Users',
      '/Users/me/',
      '/home/me',
      '/root',
      'C:\\',
      'C:\\Users\\me',
      'C:\\Windows',
      '\\\\server\\share',
      '/Volumes/WD SN7100',
      '/mnt/c',
      '/media/me/usb'
    ]) {
      expect(outputFolderEmptyingProblem(folder, PROTECT)).toBe('system-folder')
    }
  })

  it('refuses the workspace, the build context and folders holding them', () => {
    expect(outputFolderEmptyingProblem('/Users/me/src/app', PROTECT)).toBe('contains-sources')
    expect(outputFolderEmptyingProblem('/Users/me/src', PROTECT)).toBe('contains-sources')
    expect(
      outputFolderEmptyingProblem('/Users/me/src/app/web', {
        workspaceRoot: '/Users/me/src/app',
        contextDir: '/Users/me/src/app/web'
      })
    ).toBe('contains-sources')
  })

  it('refuses a path that is not absolute', () => {
    expect(outputFolderEmptyingProblem('publish/web', PROTECT)).toBe('not-absolute')
  })
})
