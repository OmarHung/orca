import type {
  CodeNavigationFileChange,
  CodeNavigationHoverQuery,
  CodeNavigationHoverResult,
  CodeNavigationQuery,
  CodeNavigationQueryResult,
  CodeNavigationServerKind,
  CodeNavigationStatusEvent
} from '../../shared/code-navigation/code-navigation-types'

export type CodeNavigationApi = {
  query: (request: CodeNavigationQuery) => Promise<CodeNavigationQueryResult>
  /** Never downloads a server; `ok: false` means keep Monaco's own hover. */
  hover: (request: CodeNavigationHoverQuery) => Promise<CodeNavigationHoverResult>
  /** Starts an installed server in the background so the first jump is fast; never downloads. */
  warm: (request: Omit<CodeNavigationHoverQuery, 'position'>) => Promise<void>
  closeDocument: (request: {
    kind: CodeNavigationServerKind
    root: string
    path: string
  }) => Promise<void>
  filesChanged: (request: { root: string; changes: CodeNavigationFileChange[] }) => Promise<void>
  onStatus: (callback: (event: CodeNavigationStatusEvent) => void) => () => void
  /** Lets main pass JetBrains-style chords (Cmd/Ctrl+B …) through to a focused code editor. */
  setCodeEditorFocused: (focused: boolean) => void
}
