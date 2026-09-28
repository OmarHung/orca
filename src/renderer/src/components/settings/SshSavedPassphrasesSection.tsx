import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'

/** Key files whose passphrase Orca saved; hidden until there is one. */
export function SshSavedPassphrasesSection(): React.JSX.Element | null {
  // Why: a passphrase saved from the credential dialog while this pane is open should appear here.
  const pendingCredentialCount = useAppStore((s) => s.sshCredentialQueue.length)
  const [keyPaths, setKeyPaths] = useState<string[]>([])
  const [forgetting, setForgetting] = useState<string | null>(null)
  const mountedRef = useMountedRef()

  const loadKeyPaths = useCallback(async () => {
    try {
      const result = await window.api.ssh.listSavedPassphrases()
      if (mountedRef.current) {
        setKeyPaths(result)
      }
    } catch {
      toast.error(
        translate('sshSavedPassphrases.settings.loadFailed', "Couldn't load saved passphrases")
      )
    }
  }, [mountedRef])

  useEffect(() => {
    void loadKeyPaths()
  }, [loadKeyPaths, pendingCredentialCount])

  const handleForget = async (keyPath: string): Promise<void> => {
    setForgetting(keyPath)
    try {
      await window.api.ssh.forgetSavedPassphrase({ keyPath })
    } catch {
      toast.error(
        translate('sshSavedPassphrases.settings.forgetFailed', "Couldn't forget the passphrase")
      )
    }
    if (mountedRef.current) {
      setForgetting(null)
      await loadKeyPaths()
    }
  }

  if (keyPaths.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">
          {translate('sshSavedPassphrases.settings.title', 'Saved key passphrases')}
        </p>
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshSavedPassphrases.settings.description',
            'Orca unlocks these SSH keys without asking. The passphrases are encrypted with the OS keychain.'
          )}
        </p>
      </div>
      <div className="space-y-2">
        {keyPaths.map((keyPath) => (
          <div
            key={keyPath}
            className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-4 py-2"
          >
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={keyPath}>
              {keyPath}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={forgetting !== null}
              onClick={() => void handleForget(keyPath)}
            >
              {forgetting === keyPath ? <Loader2 className="size-3 animate-spin" /> : null}
              {translate('sshSavedPassphrases.settings.forget', 'Forget')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
