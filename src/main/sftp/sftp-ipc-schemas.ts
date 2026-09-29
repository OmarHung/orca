import path from 'node:path'
import { z } from 'zod'

const MAX_TRANSFER_SOURCES = 1000

const TargetId = z.string().min(1)
const RemotePath = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('/'), 'Remote paths must be absolute')
const LocalPath = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value), 'Local paths must be absolute')

export const SftpTargetSchema = TargetId
export const SftpLocalPathSchema = LocalPath

export const SftpPathRequestSchema = z.object({ targetId: TargetId, path: RemotePath }).strict()

export const SftpRenameRequestSchema = z
  .object({ targetId: TargetId, from: RemotePath, to: RemotePath })
  .strict()

export const SftpRemoveRequestSchema = z
  .object({ targetId: TargetId, paths: z.array(RemotePath).min(1).max(MAX_TRANSFER_SOURCES) })
  .strict()

function transferRequestSchema<S extends z.ZodTypeAny, D extends z.ZodTypeAny>(
  source: S,
  destination: D
) {
  return z
    .object({
      transferId: z.string().min(1),
      targetId: TargetId,
      sources: z.array(source).min(1).max(MAX_TRANSFER_SOURCES),
      destinationDir: destination,
      overwrite: z.boolean()
    })
    .strict()
}

export const SftpUploadRequestSchema = transferRequestSchema(LocalPath, RemotePath)
export const SftpDownloadRequestSchema = transferRequestSchema(RemotePath, LocalPath)
