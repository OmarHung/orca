// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  patchBreakpointSpec,
  readPersistedBreakpoints,
  toSourceBreakpoints,
  toggleBreakpointSpec,
  useBreakpointStore
} from './breakpoint-store'

beforeEach(() => {
  window.localStorage.clear()
  useBreakpointStore.setState({
    breakpointsByFile: {},
    verifiedByFile: {},
    exceptionFiltersByAdapter: {},
    editing: null
  })
})

describe('breakpoint specs', () => {
  it('toggles breakpoints in line order', () => {
    const specs = toggleBreakpointSpec(toggleBreakpointSpec([], 9), 3)
    expect(specs).toEqual([
      { line: 3, enabled: true },
      { line: 9, enabled: true }
    ])
    expect(toggleBreakpointSpec(specs, 3)).toEqual([{ line: 9, enabled: true }])
  })

  it('drops blank condition, hit count and log message fields', () => {
    expect(
      patchBreakpointSpec(
        { line: 4, enabled: true, condition: 'x > 1' },
        { condition: '  ', hitCondition: ' 3 ', logMessage: '' }
      )
    ).toEqual({ line: 4, enabled: true, hitCondition: '3' })
  })

  it('sends only enabled breakpoints, with their extra fields', () => {
    expect(
      toSourceBreakpoints([
        { line: 1, enabled: true, condition: 'i == 2' },
        { line: 2, enabled: false },
        { line: 3, enabled: true, logMessage: 'i={i}' }
      ])
    ).toEqual([
      { line: 1, condition: 'i == 2' },
      { line: 3, logMessage: 'i={i}' }
    ])
  })
})

describe('persistence', () => {
  it('migrates v1 line lists and keeps valid v2 specs', () => {
    window.localStorage.setItem(
      'orca.debug.breakpoints.v1',
      JSON.stringify({ '/p/a.py': [4, 2, -1, 'x'] })
    )
    expect(readPersistedBreakpoints()).toEqual({
      '/p/a.py': [
        { line: 2, enabled: true },
        { line: 4, enabled: true }
      ]
    })

    window.localStorage.setItem(
      'orca.debug.breakpoints.v2',
      JSON.stringify({ '/p/b.ts': [{ line: 7, enabled: false, condition: 'ok' }, { line: 0 }] })
    )
    expect(readPersistedBreakpoints()).toEqual({
      '/p/b.ts': [{ line: 7, enabled: false, condition: 'ok' }]
    })
  })

  it('persists edits and removes files without breakpoints', () => {
    const store = useBreakpointStore.getState()
    store.toggle('/p/a.py', 5)
    store.update('/p/a.py', 5, { condition: 'n > 2', enabled: false })

    expect(JSON.parse(window.localStorage.getItem('orca.debug.breakpoints.v2') ?? '{}')).toEqual({
      '/p/a.py': [{ line: 5, enabled: false, condition: 'n > 2' }]
    })

    useBreakpointStore.getState().remove('/p/a.py', 5)
    expect(useBreakpointStore.getState().breakpointsByFile).toEqual({})
  })

  it('remembers exception filters per adapter', () => {
    useBreakpointStore.getState().setExceptionFilters('debugpy', ['raised'])

    expect(
      JSON.parse(window.localStorage.getItem('orca.debug.exceptionFilters.v1') ?? '{}')
    ).toEqual({ debugpy: ['raised'] })
  })
})
