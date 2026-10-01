// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  releaseRunPanelTerminalHosts,
  runPanelTerminalHost,
  showRunPanelTerminalHost
} from './run-panel-terminal-hosts'

function parking(): Element | null {
  return document.querySelector('[data-run-panel-parking]')
}

describe('run panel terminal hosts', () => {
  it('parks a host hidden until the panel shows it, and keeps the same node', () => {
    const host = runPanelTerminalHost('tab-1')
    expect(host.parentElement).toBe(parking())
    expect(runPanelTerminalHost('tab-1')).toBe(host)

    const panel = document.createElement('div')
    document.body.appendChild(panel)
    const park = showRunPanelTerminalHost('tab-1', panel)
    expect(host.parentElement).toBe(panel)

    park()
    expect(host.parentElement).toBe(parking())
  })

  it('leaves a host alone when another panel already took it', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const parkFirst = showRunPanelTerminalHost('tab-2', first)
    showRunPanelTerminalHost('tab-2', second)

    parkFirst()

    expect(runPanelTerminalHost('tab-2').parentElement).toBe(second)
  })

  it('releases hosts of terminals the Run panel no longer owns', () => {
    const kept = runPanelTerminalHost('kept')
    const dropped = runPanelTerminalHost('dropped')

    releaseRunPanelTerminalHosts(new Set(['kept']))

    expect(kept.isConnected).toBe(true)
    expect(dropped.isConnected).toBe(false)
    expect(runPanelTerminalHost('dropped')).not.toBe(dropped)
  })
})
