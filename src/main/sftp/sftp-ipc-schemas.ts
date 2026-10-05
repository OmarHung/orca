import path from 'node:path'
import { z } from 'zod'
import { MAX_PLAN_OPERATIONS } from './sftp-plan-builders'

export const INVALID_SFTP_REQUEST_MESSAGE = 'Invalid SFTP request'

// Why: each picked item plans at least one operation, so the plan's own cap is the real limit.
const MAX_SOURCES = MAX_PLAN_OPERATIONS
const TOO_MANY_SOURCES = `This selection has more than ${MAX_SOURCES.toLocaleString('en-US')} items. Pick fewer items.`

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
      sources: z.array(LocalPath).min(1).max(MAX_SOURCES, TOO_MANY_SOURCES),
      destinationDir: RemotePath
    })
    .strict(),
  z
    .object({
      kind: z.literal('download'),
      targetId: TargetId,
      sources: z.array(RemotePath).min(1).max(MAX_SOURCES, TOO_MANY_SOURCES),
      destinationDir: LocalPath
    })
    .strict(),
  z.object({ kind: z.literal('mkdir'), targetId: TargetId, path: RemotePath }).strict(),
  z
    .object({ kind: z.literal('rename'), targetId: TargetId, from: RemotePath, to: RemotePath })
    .strict(),
  z
    .object({
      kind: z.literal('move'),
      targetId: TargetId,
      sources: z.array(RemotePath).min(1).max(MAX_SOURCES, TOO_MANY_SOURCES),
      destinationDir: RemotePath
    })
    .strict(),
  z
    .object({
      kind: z.literal('remove'),
      targetId: TargetId,
      paths: z.array(RemotePath).min(1).max(MAX_SOURCES, TOO_MANY_SOURCES)
    })
    .strict()
])

// Why: the item cap is the one rejection a click can cause, so name it; anything else is malformed.
export function sftpPlanRequestRejection(error: z.ZodError): string {
  return (
    error.issues.find((issue) => issue.code === 'too_big')?.message ?? INVALID_SFTP_REQUEST_MESSAGE
  )
}

export const SftpExecuteRequestSchema = z
  .object({ planId: SftpPlanIdSchema, transferId: z.string().min(1) })
  .strict()
