import type {
  CodeNavigationFileChange,
  CodeNavigationQuery,
  CodeNavigationQueryResult,
  CodeNavigationServerKind,
  CodeNavigationStatusEvent
} from '../../shared/code-navigation/code-navigation-types'

export type CodeNavigationApi = {
  query: (request: CodeNavigationQuery) => Promise<CodeNavigationQueryResult>
  closeDocument: (request: {
    kind: CodeNavigationServerKind
    root: string
    path: string
  }) => Promise<void>
  filesChanged: (request: { root: string; changes: CodeNavigationFileChange[] }) => Promise<void>
  onStatus: (callback: (event: CodeNavigationStatusEvent) => void) => () => void
}
