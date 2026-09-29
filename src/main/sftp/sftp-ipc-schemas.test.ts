import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SftpDownloadRequestSchema,
  SftpPathRequestSchema,
  SftpUploadRequestSchema
} from './sftp-ipc-schemas'

const localFile = path.resolve('/tmp', 'report.csv')
const upload = {
  transferId: 't1',
  targetId: 'web',
  sources: [localFile],
  destinationDir: '/srv/app',
  overwrite: false
}

describe('SFTP IPC schemas', () => {
  it('accepts absolute local sources and a remote destination for uploads', () => {
    expect(SftpUploadRequestSchema.safeParse(upload).success).toBe(true)
  })

  it('rejects relative paths on either side', () => {
    expect(SftpUploadRequestSchema.safeParse({ ...upload, sources: ['report.csv'] }).success).toBe(
      false
    )
    expect(SftpUploadRequestSchema.safeParse({ ...upload, destinationDir: 'srv' }).success).toBe(
      false
    )
    expect(SftpPathRequestSchema.safeParse({ targetId: 'web', path: '../etc' }).success).toBe(false)
  })

  it('keeps the sides straight: downloads take remote sources and a local destination', () => {
    expect(
      SftpDownloadRequestSchema.safeParse({
        ...upload,
        sources: ['/srv/app/log.txt'],
        destinationDir: path.resolve('/tmp')
      }).success
    ).toBe(true)
  })

  it('rejects unknown fields and empty source lists', () => {
    expect(SftpUploadRequestSchema.safeParse({ ...upload, extra: true }).success).toBe(false)
    expect(SftpUploadRequestSchema.safeParse({ ...upload, sources: [] }).success).toBe(false)
  })
})
