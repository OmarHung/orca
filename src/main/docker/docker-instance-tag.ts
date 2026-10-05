import { createHash } from 'node:crypto'

/** Scopes Orca's containers to one profile directory, so a dev build never touches the app's. */
export function dockerInstanceTag(userDataPath: string): string {
  return createHash('sha256').update(userDataPath).digest('hex').slice(0, 8)
}
