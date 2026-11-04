import { describe, expect, it } from 'vitest'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import { sshSessionTabLabels } from './ssh-session-tab-labels'

// Why through resolveTerminalTabTitle: it is what TabBar actually renders.
function renderedTitle(
  labels: ReturnType<typeof sshSessionTabLabels>,
  customTitle: string | null = null
): string {
  return resolveTerminalTabTitle({ ...labels, customTitle }, false, labels.title)
}

describe('sshSessionTabLabels', () => {
  it('shows the folder after the host once the tab has one', () => {
    expect(renderedTitle(sshSessionTabLabels('web-prod', 'web-prod', '/var/log/nginx'))).toBe(
      'web-prod · nginx'
    )
  })

  it('shows only the host before any folder is known', () => {
    expect(renderedTitle(sshSessionTabLabels('web-prod', 'web-prod', undefined))).toBe('web-prod')
  })

  it('names the root folder', () => {
    expect(renderedTitle(sshSessionTabLabels('web-prod', 'web-prod', '/'))).toBe('web-prod · /')
  })

  it('keeps the folder for a tab with no quick command label', () => {
    expect(renderedTitle(sshSessionTabLabels('Terminal 1', null, '/srv'))).toBe('Terminal 1 · srv')
  })

  it('lets a name the user gave the tab win', () => {
    expect(renderedTitle(sshSessionTabLabels('web-prod', 'web-prod', '/srv'), 'deploy box')).toBe(
      'deploy box'
    )
  })
})
