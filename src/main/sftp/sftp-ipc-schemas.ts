import path from 'node:path'
import { z } from 'zod'

const MAX_SOURCES = 1000

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
export const SftpPlanIdSchema = z.string().min(1)

export const SftpPathRequestSchema = z.object({ targetId: TargetId, path: RemotePath }).strict()

export const SftpPlanRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('upload'),
      targetId: TargetId,
      sources: z.array(LocalPath).min(1).max(MAX_SOURCES),
      destinationDir: RemotePath
    })
    .strict(),
  z
    .object({
      kind: z.literal('download'),
      targetId: TargetId,
      sources: z.array(RemotePath).min(1).max(MAX_SOURCES),
      destinationDir: LocalPath
    })
    .strict(),
  z.object({ kind: z.literal('mkdir'), targetId: TargetId, path: RemotePath }).strict(),
  z
    .object({ kind: z.literal('rename'), targetId: TargetId, from: RemotePath, to: RemotePath })
    .strict(),
  z
    .object({
      kind: z.literal('remove'),
      targetId: TargetId,
      paths: z.array(RemotePath).min(1).max(MAX_SOURCES)
    })
    .strict()
])

export const SftpExecuteRequestSchema = z
  .object({ planId: SftpPlanIdSchema, transferId: z.string().min(1) })
  .strict()
