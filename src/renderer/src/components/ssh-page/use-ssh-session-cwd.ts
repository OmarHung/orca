import { useEffect, useState } from 'react'

/** Local directory the SSH page's shells start in: the home directory, as for a blank floating cwd. */
export function useSshSessionCwd(): string | null {
  const [cwd, setCwd] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.app
      .getFloatingTerminalCwd({ path: '' })
      .then((resolved) => {
        if (!cancelled) {
          setCwd(resolved)
        }
      })
      .catch(() => {
        // Why: without a cwd the panes stay unmounted; the empty state still offers hosts.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return cwd
}
