import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { ForkUpdateChangelog } from '../../shared/fork-update-changelog'

const launchSchema = z.object({
  baseTag: z.string().min(1),
  commit: z.string().min(1).nullable()
})

const releaseNoteSchema = z.object({
  tag: z.string(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  body: z.string()
})

const summarySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('generating'), locale: z.string() }),
  z.object({
    status: z.literal('ready'),
    locale: z.string(),
    markdown: z.string(),
    agentLabel: z.string()
  }),
  z.object({ status: z.literal('failed'), locale: z.string(), error: z.string() })
])

const changelogSchema = z.object({
  fromTag: z.string().min(1),
  toTag: z.string().min(1),
  releaseNotes: z.array(releaseNoteSchema),
  forkCommits: z.array(z.object({ sha: z.string(), subject: z.string() })).nullable(),
  summary: summarySchema.nullable(),
  seen: z.boolean(),
  createdAt: z.number()
}) satisfies z.ZodType<ForkUpdateChangelog>

const fileSchema = z.object({
  /** The fork build that ran last; a different base tag at the next launch means it updated. */
  lastLaunch: launchSchema.nullable(),
  changelog: changelogSchema.nullable()
})

export type ForkChangelogLaunch = z.infer<typeof launchSchema>
export type ForkChangelogFile = z.infer<typeof fileSchema>

const EMPTY_FILE: ForkChangelogFile = { lastLaunch: null, changelog: null }

export function parseForkChangelogFile(raw: unknown): ForkChangelogFile {
  const parsed = fileSchema.safeParse(raw)
  return parsed.success ? parsed.data : EMPTY_FILE
}

/** Persists next to the app's other per-install files, not per profile: it tracks the build. */
export function createForkChangelogFileStore(userDataDir: string): {
  read: () => ForkChangelogFile
  write: (file: ForkChangelogFile) => void
} {
  const filePath = path.join(userDataDir, 'fork-update-changelog.json')
  return {
    read: () => {
      try {
        return parseForkChangelogFile(JSON.parse(readFileSync(filePath, 'utf8')))
      } catch {
        return EMPTY_FILE
      }
    },
    write: (file) => {
      try {
        mkdirSync(userDataDir, { recursive: true })
        const tempPath = `${filePath}.tmp`
        writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
        renameSync(tempPath, filePath)
      } catch (error) {
        // Why only log: losing this file costs one changelog, never the app's startup.
        console.warn('[fork-update-changelog] could not save:', error)
      }
    }
  }
}
