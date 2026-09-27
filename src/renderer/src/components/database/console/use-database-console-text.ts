import { useCallback, useEffect, useRef, useState } from 'react'
import type { DatabaseConsoleRef } from '../../../../../shared/database/database-session-types'

const SAVE_DELAY_MS = 400

/** Loads a console's text from main and saves edits after a short pause (and on unmount). */
export function useDatabaseConsoleText(ref: DatabaseConsoleRef): {
  text: string | null
  update: (text: string) => void
} {
  const { connectionId, consoleId } = ref
  const [loaded, setLoaded] = useState<{ consoleId: string; text: string } | null>(null)
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending !== null) {
      void window.api.database
        .writeConsole({ connectionId, consoleId }, pending)
        ?.catch(() => undefined)
    }
  }, [connectionId, consoleId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve(window.api.database.readConsole({ connectionId, consoleId }))
      .then((text) => (typeof text === 'string' ? text : ''))
      .catch(() => '')
      .then((text) => {
        if (!cancelled) {
          setLoaded({ consoleId, text })
        }
      })
    return () => {
      cancelled = true
      flush()
    }
  }, [connectionId, consoleId, flush])

  const update = useCallback(
    (text: string) => {
      pendingRef.current = text
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush]
  )

  return { text: loaded?.consoleId === consoleId ? loaded.text : null, update }
}
