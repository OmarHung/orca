import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SftpExecuteRequestSchema,
  SftpPathRequestSchema,
  SftpPlanRequestSchema
} from './sftp-ipc-schemas'

const localFile = path.resolve('/tmp', 'report.csv')
const upload = {
  kind: 'upload',
  targetId: 'web',
  sources: [localFile],
  destinationDir: '/srv/app'
}

describe('SFTP IPC schemas', () => {
  it('accepts absolute local sources and a remote destination for uploads', () => {
    expect(SftpPlanRequestSchema.safeParse(upload).success).toBe(true)
  })

  it('rejects relative paths on either side', () => {
    expect(SftpPlanRequestSchema.safeParse({ ...upload, sources: ['report.csv'] }).success).toBe(
      false
    )
    expect(SftpPlanRequestSchema.safeParse({ ...upload, destinationDir: 'srv' }).success).toBe(
      false
    )
    expect(SftpPathRequestSchema.safeParse({ targetId: 'web', path: '../etc' }).success).toBe(false)
    expect(
      SftpPlanRequestSchema.safeParse({ kind: 'remove', targetId: 'web', paths: ['srv'] }).success
    ).toBe(false)
  })

  it('keeps the sides straight: downloads take remote sources and a local destination', () => {
    expect(
      SftpPlanRequestSchema.safeParse({
        ...upload,
        kind: 'download',
        sources: ['/srv/app/log.txt'],
        destinationDir: path.resolve('/tmp')
      }).success
    ).toBe(true)
    expect(
      SftpPlanRequestSchema.safeParse({
        ...upload,
        kind: 'download',
        sources: ['/srv/app/log.txt'],
        destinationDir: 'downloads'
      }).success
    ).toBe(false)
  })

  it('rejects unknown kinds and fields, empty lists, and operations sent from the renderer', () => {
    expect(SftpPlanRequestSchema.safeParse({ ...upload, kind: 'chmod' }).success).toBe(false)
    expect(SftpPlanRequestSchema.safeParse({ ...upload, extra: true }).success).toBe(false)
    expect(SftpPlanRequestSchema.safeParse({ ...upload, sources: [] }).success).toBe(false)
    expect(
      SftpExecuteRequestSchema.safeParse({
        planId: 'p1',
        transferId: 't1',
        operations: [{ op: 'rm', path: '/' }]
      }).success
    ).toBe(false)
  })
})
