// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandConfirmOptions } from '../command-confirm/command-confirm-context'
import type {
  SftpExecuteOutcome,
  SftpExecuteRequest,
  SftpPlan,
  SftpPlanRequest,
  SftpResult
} from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { runSftpAction } from './sftp-plan-actions'
import { useSftpTransfersStore } from './sftp-transfers-store'

const target: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

const upload: SftpPlanRequest = {
  kind: 'upload',
  targetId: 'web',
  sources: ['/Users/dev/report.csv', '/Users/dev/logs'],
  destinationDir: '/srv/app'
}

const plan: SftpPlan = {
  planId: 'p1',
  kind: 'upload',
  targetId: 'web',
  operations: [
    {
      op: 'put',
      local: '/Users/dev/report.csv',
      remote: '/srv/app/report.csv',
      size: 2048,
      source: { dev: '1', ino: '2' }
    },
    { op: 'mkdir', path: '/srv/app/logs', keepExisting: true }
  ],
  totalBytes: 2048,
  conflicts: []
}

let planCall: ReturnType<typeof vi.fn<(request: SftpPlanRequest) => Promise<SftpResult<SftpPlan>>>>
let execute: ReturnType<
  typeof vi.fn<(request: SftpExecuteRequest) => Promise<SftpResult<SftpExecuteOutcome>>>
>
let discardPlan: ReturnType<typeof vi.fn<(planId: string) => Promise<void>>>
let confirm: ReturnType<typeof vi.fn<(options: CommandConfirmOptions) => Promise<boolean>>>

beforeEach(() => {
  useSftpTransfersStore.setState({ transfers: [] })
  planCall = vi.fn(async () => ({ ok: true, value: plan }))
  execute = vi.fn(async () => ({ ok: true, value: { status: 'done' } }))
  discardPlan = vi.fn(async () => undefined)
  confirm = vi.fn(async () => true)
  Reflect.set(window, 'api', { sftp: { plan: planCall, execute, discardPlan } })
})

describe('runSftpAction', () => {
  it('shows the stored plan line for line, then runs that plan by id only', async () => {
    expect(await runSftpAction(upload, { target, confirm })).toBe(true)

    const [options] = confirm.mock.calls[0]
    expect(options.commands).toEqual([
      'put "/Users/dev/report.csv" "/srv/app/report.csv"',
      '-mkdir "/srv/app/logs"'
    ])
    expect(options.details).toEqual([
      'Host: web-prod (deploy@203.0.113.10:22)',
      'Files: 1 · Folders: 1 · Size: 2.00 KB'
    ])
    expect(execute).toHaveBeenCalledWith({ planId: 'p1', transferId: expect.any(String) })
    const [transfer] = useSftpTransfersStore.getState().transfers
    expect(transfer).toMatchObject({ status: 'done', label: 'report.csv and 1 more' })
  })

  it('runs nothing and drops the plan when the user cancels', async () => {
    confirm.mockResolvedValue(false)

    expect(await runSftpAction(upload, { target, confirm })).toBe(false)

    expect(execute).not.toHaveBeenCalled()
    expect(discardPlan).toHaveBeenCalledWith('p1')
    expect(useSftpTransfersStore.getState().transfers).toEqual([])
  })

  it('warns about replaced items and makes the confirm destructive', async () => {
    planCall.mockResolvedValue({ ok: true, value: { ...plan, conflicts: ['report.csv'] } })

    await runSftpAction(upload, { target, confirm })

    const [options] = confirm.mock.calls[0]
    expect(options.isDestructive).toBe(true)
    expect(options.warnings?.join('\n')).toContain('report.csv')
  })

  it('never asks when there is nothing to run', async () => {
    planCall.mockResolvedValue({ ok: true, value: { ...plan, operations: [], totalBytes: 0 } })

    expect(await runSftpAction(upload, { target, confirm })).toBe(false)

    expect(confirm).not.toHaveBeenCalled()
    expect(discardPlan).toHaveBeenCalledWith('p1')
  })

  it('keeps the error of a failed transfer', async () => {
    execute.mockResolvedValue({ ok: false, error: { message: 'Permission denied' } })

    expect(await runSftpAction(upload, { target, confirm })).toBe(false)

    expect(useSftpTransfersStore.getState().transfers[0]).toMatchObject({
      status: 'failed',
      error: 'Permission denied'
    })
  })

  it('marks deletes destructive', async () => {
    planCall.mockResolvedValue({
      ok: true,
      value: {
        ...plan,
        kind: 'remove',
        operations: [
          { op: 'rm', path: '/srv/app/a.txt' },
          { op: 'rmdir', path: '/srv/app' }
        ],
        totalBytes: 0
      }
    })

    await runSftpAction(
      { kind: 'remove', targetId: 'web', paths: ['/srv/app'] },
      { target, confirm }
    )

    const [options] = confirm.mock.calls[0]
    expect(options).toMatchObject({ isDestructive: true, title: 'Delete from web-prod?' })
    expect(options.commands).toEqual(['rm "/srv/app/a.txt"', 'rmdir "/srv/app"'])
    expect(useSftpTransfersStore.getState().transfers).toEqual([])
  })

  describe('move', () => {
    const move: SftpPlanRequest = {
      kind: 'move',
      targetId: 'web',
      sources: ['/srv/app/a.txt'],
      destinationDir: '/srv/backup'
    }
    const movePlan: SftpPlan = {
      ...plan,
      kind: 'move',
      operations: [{ op: 'rename', from: '/srv/app/a.txt', to: '/srv/backup/a.txt' }],
      totalBytes: 0
    }

    it('confirms the renames it will run, without starting a transfer', async () => {
      planCall.mockResolvedValue({ ok: true, value: movePlan })

      expect(await runSftpAction(move, { target, confirm })).toBe(true)

      const [options] = confirm.mock.calls[0]
      expect(options).toMatchObject({
        title: 'Move on web-prod?',
        confirmLabel: 'Move',
        isDestructive: false
      })
      expect(options.commands).toEqual(['rename "/srv/app/a.txt" "/srv/backup/a.txt"'])
      expect(useSftpTransfersStore.getState().transfers).toEqual([])
    })

    it('refuses without asking when a name is already taken in the folder', async () => {
      planCall.mockResolvedValue({ ok: true, value: { ...movePlan, conflicts: ['a.txt'] } })

      expect(await runSftpAction(move, { target, confirm })).toBe(false)

      expect(confirm).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
      expect(discardPlan).toHaveBeenCalledWith('p1')
    })
  })
})
