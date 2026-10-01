import type { SshTarget } from '../../../../shared/ssh-types'
import { isClipboardTextByteLengthOverLimit } from '../../../../shared/clipboard-text'

/** Pasted queries above this are rejected so filtering never runs on unbounded input. */
export const SSH_TARGET_SEARCH_QUERY_MAX_BYTES = 2 * 1024

type SearchableSshTarget = Pick<
  SshTarget,
  'label' | 'configHost' | 'host' | 'port' | 'username' | 'identityFile'
>

/** Targets whose card text (plus any `extraText`) contains every whitespace-separated term. */
export function filterSshTargetsBySearchQuery<T extends SearchableSshTarget>(
  targets: readonly T[],
  rawQuery: string,
  extraText?: (target: T) => string
): T[] {
  if (isClipboardTextByteLengthOverLimit(rawQuery, SSH_TARGET_SEARCH_QUERY_MAX_BYTES)) {
    return []
  }
  const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return [...targets]
  }
  return targets.filter((target) => {
    const extra = extraText?.(target)
    const text = extra
      ? `${getSshTargetSearchText(target)}\n${extra.toLowerCase()}`
      : getSshTargetSearchText(target)
    return terms.every((term) => text.includes(term))
  })
}

/** The `user@host:port` line shown under a target's label. */
export function formatSshTargetEndpoint(
  target: Pick<SshTarget, 'host' | 'port' | 'username'>
): string {
  return target.username
    ? `${target.username}@${target.host}:${target.port}`
    : `${target.host}:${target.port}`
}

function getSshTargetSearchText(target: SearchableSshTarget): string {
  // Why: newline-joined so a single term cannot match across two fields.
  return [
    target.label,
    target.configHost ?? '',
    formatSshTargetEndpoint(target),
    target.identityFile ?? ''
  ]
    .join('\n')
    .toLowerCase()
}
