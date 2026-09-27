import { describe, expect, it } from 'vitest'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { DebugSessionView } from '../debug/debug-store'
import type { RunSession } from './run-session-store'
import {
  footprintRuns,
  isFootprintActive,
  isFootprintDebugging,
  runningProcesses,
  runWidgetFootprint,
  worktreeRunActivity
} from './run-widget-activity'
import { runWidgetItems } from './run-widget-items'

const configurations: RunConfigurationDefinition[] = [
  { type: 'command', id: 'build', name: 'Build', command: 'make' },
  { type: 'command', id: 'shop', name: 'shop:dev', command: 'pnpm dev', beforeLaunch: ['build'] },
  { type: 'command', id: 'admin', name: 'admin:dev', command: 'pnpm dev' },
  {
    type: 'debug',
    id: 'api',
    name: 'Api',
    target: { kind: 'dotnet-program', program: 'bin/Api.dll' }
  },
  { type: 'compound', id: 'web', name: 'Web', configurations: ['shop', 'admin'] },
  { type: 'compound', id: 'all', name: 'Run:all', configurations: ['web', 'api'] },
  { type: 'compound', id: 'broken', name: 'Broken', configurations: ['missing'] }
]

const items = runWidgetItems({
  recent: [
    {
      worktreeId: 'wt',
      groupId: null,
      commandKey: 'detected:api',
      command: {
        id: 'detected:api',
        label: 'Api: https',
        command: 'dotnet run',
        appendEnter: true
      }
    }
  ],
  configurations: configurations.map((configuration) => ({ source: 'local', configuration })),
  quickCommands: [
    {
      key: 'local:agent',
      hostId: 'local',
      hostLabel: 'This Mac',
      command: { id: 'agent', label: 'Ask', action: 'agent-prompt', agent: 'claude', prompt: 'hi' }
    }
  ]
})

function itemByLabel(label: string) {
  const item = items.find((candidate) => candidate.label === label)
  if (!item) {
    throw new Error(`no item ${label}`)
  }
  return item
}

function footprint(label: string) {
  return runWidgetFootprint(itemByLabel(label), configurations)
}

function session(commandKey: string, overrides: Partial<RunSession> = {}): RunSession {
  return {
    key: `wt\u0000${commandKey}`,
    worktreeId: 'wt',
    commandKey,
    label: commandKey,
    tabId: `tab-${commandKey}`,
    status: 'running',
    exitCode: null,
    ...overrides
  }
}

const debugSession: DebugSessionView = {
  id: 'd1',
  worktreeId: 'wt',
  title: 'Api',
  sourceKey: 'config:api',
  phase: 'running',
  stoppedThreadId: null,
  stopReason: null
}

describe('runWidgetFootprint', () => {
  it('covers every member of nested compounds, their Before launch steps and the debug member', () => {
    expect(footprint('Run:all')).toEqual({
      commandKeys: ['config:build', 'config:shop', 'config:admin'],
      debugSourceKeys: ['config:all', 'config:api']
    })
  })

  it('gives single items their own run or debug key', () => {
    expect(footprint('shop:dev')).toEqual({ commandKeys: ['config:shop'], debugSourceKeys: [] })
    expect(footprint('Api')).toEqual({ commandKeys: [], debugSourceKeys: ['config:api'] })
    expect(footprint('Api: https')).toEqual({
      commandKeys: ['detected:api'],
      debugSourceKeys: ['recent:detected:api']
    })
  })

  it('gives agent prompts and unplannable compounds no runs', () => {
    expect(footprint('Ask').commandKeys).toEqual([])
    expect(footprint('Broken').commandKeys).toEqual([])
  })
})

describe('worktreeRunActivity', () => {
  it('keeps active runs with a live tab in this worktree, and a debug session that has not ended', () => {
    const activity = worktreeRunActivity({
      worktreeId: 'wt',
      sessions: [
        session('config:shop'),
        session('config:admin', { status: 'succeeded', exitCode: 0 }),
        session('config:build', { tabId: 'closed' }),
        session('config:other', { worktreeId: 'wt2' }),
        session('detected:api', { status: 'stopping' })
      ],
      liveTabIds: new Set(['tab-config:shop', 'tab-config:admin', 'tab-detected:api']),
      debug: debugSession
    })
    expect(activity.runs.map((run) => run.commandKey)).toEqual(['config:shop', 'detected:api'])
    expect(activity.debug).toBe(debugSession)
    expect(
      worktreeRunActivity({
        worktreeId: 'wt',
        sessions: [],
        liveTabIds: new Set(),
        debug: { ...debugSession, phase: 'ended' }
      }).debug
    ).toBeNull()
  })
})

describe('footprint activity', () => {
  const activity = { runs: [session('config:admin')], debug: debugSession }

  it('reports the compound as active through any member', () => {
    expect(footprintRuns(footprint('Run:all'), activity).map((run) => run.commandKey)).toEqual([
      'config:admin'
    ])
    expect(isFootprintDebugging(footprint('Run:all'), activity)).toBe(true)
    expect(isFootprintActive(footprint('shop:dev'), activity)).toBe(false)
    expect(isFootprintActive(footprint('Api'), activity)).toBe(true)
    expect(isFootprintActive(footprint('Web'), { runs: [], debug: debugSession })).toBe(false)
  })

  it('lists runs, then the debug session, for the Stop menu', () => {
    expect(runningProcesses(activity)).toEqual([
      {
        kind: 'run',
        key: 'wt\u0000config:admin',
        label: 'config:admin',
        commandKey: 'config:admin',
        stage: 'interrupt'
      },
      { kind: 'debug', key: 'debug:d1', label: 'Api' }
    ])
  })
})
