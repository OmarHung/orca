import { net } from 'electron'
import { z } from 'zod'
import { runProcess } from '../../shared/child-process/run-process'
import type { ForkReleaseNote } from '../../shared/fork-sync-status'
import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'
import type { ForkSourceIdentity } from './fork-source-identity'
import { compareReleaseTags } from './fork-source-release-tags'

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/
// Why one page: a single request covers every release a fork falls behind between checks.
const RELEASES_PER_PAGE = 30
const REQUEST_TIMEOUT_MS = 10_000
const REMOTE_URL_TIMEOUT_MS = 10_000
/** Keeps the update status small enough to broadcast; the release page has the full text. */
const MAX_NOTE_BODY_CHARS = 20_000

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  html_url: z.string().startsWith('https://github.com/'),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean()
})

type GitHubRepo = { owner: string; repo: string }

/** `owner/repo` of a GitHub remote URL (https or ssh); null for other hosts. */
export function parseGitHubRemote(remoteUrl: string): GitHubRepo | null {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      remoteUrl.trim()
    )
  return match ? { owner: match[1], repo: match[2] } : null
}

function truncateBody(body: string): string {
  return body.length > MAX_NOTE_BODY_CHARS ? `${body.slice(0, MAX_NOTE_BODY_CHARS)}…` : body
}

/** Published releases after `baseTag` up to `targetTag`, newest first. */
export function selectReleaseNotes(
  releases: unknown,
  baseTag: string,
  targetTag: string
): ForkReleaseNote[] {
  if (!Array.isArray(releases)) {
    return []
  }
  const notes: ForkReleaseNote[] = []
  for (const raw of releases) {
    const parsed = releaseSchema.safeParse(raw)
    if (!parsed.success) {
      continue
    }
    const release = parsed.data
    if (
      release.draft ||
      release.prerelease ||
      !RELEASE_TAG.test(release.tag_name) ||
      compareReleaseTags(release.tag_name, baseTag) <= 0 ||
      compareReleaseTags(release.tag_name, targetTag) > 0
    ) {
      continue
    }
    notes.push({
      tag: release.tag_name,
      title: release.name?.trim() || release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
      body: truncateBody(release.body ?? '')
    })
  }
  return notes.sort((a, b) => compareReleaseTags(b.tag, a.tag))
}

async function resolveUpstreamUrl(identity: ForkSourceIdentity): Promise<string> {
  const result = await runProcess({
    program: 'git',
    args: ['remote', 'get-url', identity.upstreamRemote],
    cwd: identity.repoRoot,
    env: await resolveLoginShellEnvironment(),
    timeoutMs: REMOTE_URL_TIMEOUT_MS
  })
  // Why fall back: the identity may name the upstream by URL rather than by remote.
  return result.code === 0 ? result.stdout.trim() : identity.upstreamRemote
}

/** Release notes from the upstream's GitHub releases; empty when upstream is not on GitHub. */
export async function fetchUpstreamReleaseNotes(
  identity: ForkSourceIdentity,
  baseTag: string,
  targetTag: string
): Promise<ForkReleaseNote[]> {
  const repo = parseGitHubRemote(await resolveUpstreamUrl(identity))
  if (!repo) {
    return []
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases?per_page=${RELEASES_PER_PAGE}`
  const response = await net.fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`GitHub releases request failed with ${response.status}`)
  }
  return selectReleaseNotes(await response.json(), baseTag, targetTag)
}
