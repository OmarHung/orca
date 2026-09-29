import { Terminal } from 'lucide-react'
import type { Repo } from '../../../../shared/repo-types'
import { isRepoInitialTab, resolveRepoInitialTab } from '../../../../shared/repo-initial-tab'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'

type RepositoryInitialTabSettingProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: Pick<Repo, 'initialTab'>) => void | Promise<boolean>
  forceVisible: boolean
}

export function RepositoryInitialTabSetting({
  repo,
  updateRepo,
  forceVisible
}: RepositoryInitialTabSettingProps): React.JSX.Element {
  const disabledTuiAgents = useAppStore((state) => state.settings?.disabledTuiAgents)
  const value = resolveRepoInitialTab(repo.initialTab)
  // Why: keep a disabled selection listed so the trigger still names what is saved.
  const agentOptions = getAgentCatalog().filter(
    (agent) => agent.id === value || isTuiAgentEnabled(agent.id, disabledTuiAgents)
  )
  const title = translate('auto.components.settings.RepositoryPane.initialTab', 'Initial Tab')

  return (
    <SearchableSetting
      title={title}
      description={translate(
        'auto.components.settings.RepositoryPane.initialTabDescription',
        'What opens when a workspace of this project has no tabs.'
      )}
      keywords={[repo.displayName, 'initial tab', 'default tab', 'terminal', 'agent', 'claude']}
      className="space-y-2"
      forceVisible={forceVisible}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Label>{title}</Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RepositoryPane.initialTabHelp',
              'Opens when a workspace of this project has no tabs. A disabled agent falls back to a terminal.'
            )}
          </p>
        </div>
        <Select
          value={value}
          onValueChange={(next) => {
            if (isRepoInitialTab(next)) {
              void updateRepo(repo.id, { initialTab: next })
            }
          }}
        >
          <SelectTrigger size="sm" className="w-[180px]" aria-label={title}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="terminal">
              <span className="flex items-center gap-2">
                <Terminal className="size-3.5 text-muted-foreground" />
                {translate(
                  'auto.components.settings.RepositoryPane.initialTabTerminal',
                  'Terminal'
                )}
              </span>
            </SelectItem>
            {agentOptions.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <span className="flex items-center gap-2">
                  <AgentIcon agent={agent.id} size={14} />
                  {agent.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SearchableSetting>
  )
}
