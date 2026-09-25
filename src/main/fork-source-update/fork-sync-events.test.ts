import { describe, expect, it } from 'vitest'
import { OutputTail, parseForkSyncEventLine } from './fork-sync-events'

describe('parseForkSyncEventLine', () => {
  it('parses stage, conflict, and done events', () => {
    expect(parseForkSyncEventLine('ORCA_SYNC_EVENT {"type":"stage","stage":"build"}')).toEqual({
      type: 'stage',
      stage: 'build'
    })
    expect(
      parseForkSyncEventLine(
        'ORCA_SYNC_EVENT {"type":"conflict","worktree":"/w","baseTag":"v1.4.211","files":["a.ts"],"commitSubject":"feat: x"}'
      )
    ).toEqual({
      type: 'conflict',
      worktree: '/w',
      baseTag: 'v1.4.211',
      files: ['a.ts'],
      commitSubject: 'feat: x'
    })
    expect(
      parseForkSyncEventLine(
        'ORCA_SYNC_EVENT {"type":"done","manifestPath":"/r/dist/latest-mac.yml"}'
      )
    ).toEqual({ type: 'done', manifestPath: '/r/dist/latest-mac.yml' })
  })

  it('ignores ordinary output, malformed JSON, and unknown stages', () => {
    expect(parseForkSyncEventLine('$ pnpm tc')).toBeNull()
    expect(parseForkSyncEventLine('ORCA_SYNC_EVENT {not json')).toBeNull()
    expect(parseForkSyncEventLine('ORCA_SYNC_EVENT {"type":"stage","stage":"deploy"}')).toBeNull()
  })
})

describe('OutputTail', () => {
  it('keeps only the newest lines', () => {
    const tail = new OutputTail(2)
    tail.push('a')
    tail.push('b')
    tail.push('c')
    expect(tail.toString()).toBe('b\nc')
  })
})
