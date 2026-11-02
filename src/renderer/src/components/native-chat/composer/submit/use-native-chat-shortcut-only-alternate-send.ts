import { useAppStore } from '@/store'

/** Fork: in shortcut-only mode the chord is the plain send, so it has no alternate to advertise. */
export function useNativeChatShortcutOnlyAlternateSend<T>(alternateSend: T): T | undefined {
  const sendWithShortcutOnly = useAppStore(
    (s) => s.settings?.nativeChatSendWithShortcutOnly === true
  )
  return sendWithShortcutOnly ? undefined : alternateSend
}
