import { compareAppVersions } from '../../shared/app-version'

const RELEASE_TAG_REF = /^[0-9a-f]{40}\trefs\/tags\/(v\d+\.\d+\.\d+)$/

/** Newest plain release tag (`vX.Y.Z`, no rc/hourly suffix) in `git ls-remote --tags --refs` output. */
export function pickLatestReleaseTag(lsRemoteOutput: string): string | null {
  let latest: string | null = null
  for (const line of lsRemoteOutput.split('\n')) {
    const tag = RELEASE_TAG_REF.exec(line.trim())?.[1]
    if (tag && (latest === null || compareReleaseTags(tag, latest) > 0)) {
      latest = tag
    }
  }
  return latest
}

export function compareReleaseTags(a: string, b: string): number {
  return compareAppVersions(a.slice(1), b.slice(1))
}
