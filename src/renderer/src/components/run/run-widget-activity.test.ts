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
  runWidgetLiveStatus,
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
    leafId: `leaf-${commandKey}`,
    attemptId: `attempt-${commandKey}`,
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
  it('keeps active runs with a live tab in this worktree, and debug sessions that have not ended', () => {
    const activity = worktreeRunActivity({
      worktreeId: 'wt',
      sessions: [
        session('config:shop'),
        session('config:admin', { status: 'succeeded', exitCode: 0 }),
        session('config:build', { tabId: 'closed' }),
        session('config:other', { worktreeId: 'wt2' }),
        session('detected:api', { status: 'stopping' })
      ],
      liveLeafIds: new Set(['leaf-config:shop', 'leaf-config:admin', 'leaf-detected:api']),
      debugSessions: [
        debugSession,
        { ...debugSession, id: 'd2', phase: 'ended' },
        { ...debugSession, id: 'd3', worktreeId: 'wt2' }
      ]
    })
    expect(activity.runs.map((run) => run.commandKey)).toEqual(['config:shop', 'detected:api'])
    expect(activity.debugSessions).toEqual([debugSession])
  })
})

describe('footprint activity', () => {
  const activity = { runs: [session('config:admin')], debugSessions: [debugSession] }

  it('reports the compound as active through any member', () => {
    expect(footprintRuns(footprint('Run:all'), activity).map((run) => run.commandKey)).toEqual([
      'config:admin'
    ])
    expect(isFootprintDebugging(footprint('Run:all'), activity)).toBe(true)
    expect(isFootprintActive(footprint('shop:dev'), activity)).toBe(false)
    expect(isFootprintActive(footprint('Api'), activity)).toBe(true)
    expect(isFootprintActive(footprint('Web'), { runs: [], debugSessions: [debugSession] })).toBe(
      false
    )
  })

  it('gives the trigger the oldest run, else the debug session, else nothing', () => {
    const run = session('config:admin')
    expect(runWidgetLiveStatus(itemByLabel('Run:all'), footprint('Run:all'), activity)).toEqual({
      mode: 'run',
      run
    })
    expect(runWidgetLiveStatus(itemByLabel('Api'), footprint('Api'), activity)).toEqual({
      mode: 'debug',
      run: null
    })
    expect(runWidgetLiveStatus(itemByLabel('shop:dev'), footprint('shop:dev'), activity)).toBe(null)
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
      { kind: 'debug', key: 'debug:d1', label: 'Api', sessionId: 'd1' }
    ])
  })
})
