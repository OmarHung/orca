import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  CodeNavigationServerKind,
  CodeNavigationStatusEvent
} from '../../../../shared/code-navigation/code-navigation-types'

// Why delayed: a TypeScript server is usually ready in well under a second, so a toast would flash.
const STARTING_TOAST_DELAY_MS = 800
// Why longer: the hint names a command to run.
const NUXT_HINT_DURATION_MS = 12_000

const LANGUAGE_NAMES: Record<CodeNavigationServerKind, string> = {
  typescript: 'TypeScript/JavaScript',
  csharp: 'C#',
  vue: 'Vue'
}

const startingTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearStartingTimer(id: string): void {
  const timer = startingTimers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    startingTimers.delete(id)
  }
}

export function showCodeNavigationStatus(event: CodeNavigationStatusEvent): void {
  const id = `code-navigation:${event.kind}:${event.root}`
  const language = LANGUAGE_NAMES[event.kind]
  clearStartingTimer(id)
  switch (event.phase) {
    case 'downloading':
      toast.loading(
        translate('codeNavigation.downloading', 'Downloading the {{language}} language server…', {
          language
        }),
        { id }
      )
      return
    case 'starting':
      startingTimers.set(
        id,
        setTimeout(() => {
          startingTimers.delete(id)
          toast.loading(
            translate(
              'codeNavigation.starting',
              'Loading the {{language}} project for code navigation…',
              { language }
            ),
            { id }
          )
        }, STARTING_TOAST_DELAY_MS)
      )
      return
    case 'ready':
      toast.dismiss(id)
      return
    case 'nuxtTypesMissing':
      // Why its own id: the 'ready' that follows dismisses the loading toast, not this one.
      toast.info(
        translate(
          'codeNavigation.nuxtTypesMissing',
          'This Nuxt project has no generated types yet, so auto-imports cannot be followed. Run `nuxi prepare` in {{project}}.',
          { project: event.root.split(/[\\/]/).pop() ?? event.root }
        ),
        { id: `${id}:nuxt-types`, duration: NUXT_HINT_DURATION_MS }
      )
      return
    case 'failed':
      toast.error(
        translate(
          'codeNavigation.failed',
          '{{language}} code navigation is unavailable: {{message}}',
          { language, message: event.message ?? '' }
        ),
        { id }
      )
  }
}

export function installCodeNavigationStatusToasts(): () => void {
  return window.api?.codeNavigation?.onStatus(showCodeNavigationStatus) ?? (() => {})
}
