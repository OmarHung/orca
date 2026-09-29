// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useSshTargetList } from './use-ssh-target-list'

const target: SshTarget = {
  id: 'web',
  label: 'web-prod-203.0.113.10',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

let container: HTMLDivElement
let root: Root

function Probe(): React.JSX.Element {
  const { status, targets } = useSshTargetList()
  return <div data-status={status}>{targets.map((t) => t.label).join(',')}</div>
}

function installSshApi(api: {
  importConfig: () => Promise<unknown>
  listTargets: () => Promise<unknown>
}): void {
  Reflect.set(window, 'api', { ssh: api })
}

async function render(): Promise<HTMLElement> {
  await act(async () => root.render(<Probe />))
  const probe = container.firstElementChild
  if (!(probe instanceof HTMLElement)) {
    throw new Error('probe not rendered')
  }
  return probe
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'api')
})

describe('useSshTargetList', () => {
  it('syncs ~/.ssh/config before listing the targets', async () => {
    const calls: string[] = []
    installSshApi({
      importConfig: vi.fn(async () => {
        calls.push('import')
        return { targets: [], repoReadoptions: [] }
      }),
      listTargets: vi.fn(async () => {
        calls.push('list')
        return [target]
      })
    })

    const probe = await render()

    expect(calls).toEqual(['import', 'list'])
    expect(probe.dataset.status).toBe('ready')
    expect(probe.textContent).toBe('web-prod-203.0.113.10')
  })

  it('still lists known targets when the config sync fails', async () => {
    installSshApi({
      importConfig: vi.fn(async () => {
        throw new Error('bad config')
      }),
      listTargets: vi.fn(async () => [target])
    })

    const probe = await render()

    expect(probe.dataset.status).toBe('ready')
    expect(probe.textContent).toBe('web-prod-203.0.113.10')
  })

  it('reports an error when the targets cannot be listed', async () => {
    installSshApi({
      importConfig: vi.fn(async () => ({ targets: [], repoReadoptions: [] })),
      listTargets: vi.fn(async () => {
        throw new Error('ipc down')
      })
    })

    const probe = await render()

    expect(probe.dataset.status).toBe('error')
  })
})
