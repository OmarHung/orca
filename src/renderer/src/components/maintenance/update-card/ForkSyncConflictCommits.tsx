import React from 'react'
import type { ForkSyncConflictCommit } from '../../../../../shared/fork-sync-status'

const SHORT_SHA_LENGTH = 10

/** Every fork commit the dry run found conflicting, each with the files it conflicts in. */
export function ForkSyncConflictCommits({
  commits
}: {
  commits: ForkSyncConflictCommit[]
}): React.JSX.Element {
  return (
    <ol
      className="scrollbar-sleek flex max-h-64 flex-col gap-2 overflow-y-auto"
      data-testid="fork-sync-conflict-commits"
    >
      {commits.map((commit) => (
        <li key={commit.sha} className="flex flex-col gap-0.5">
          <p className="truncate text-xs" title={commit.subject}>
            <span className="font-mono text-muted-foreground">
              {commit.sha.slice(0, SHORT_SHA_LENGTH)}
            </span>{' '}
            {commit.subject}
          </p>
          <ul className="flex flex-col gap-0.5 pl-3 font-mono text-[11px] text-foreground">
            {commit.files.map((file) => (
              <li key={file} className="truncate" title={file}>
                {file}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
