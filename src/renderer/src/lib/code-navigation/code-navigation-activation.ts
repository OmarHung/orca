import type * as Monaco from 'monaco-editor'
import type {
  CodeNavigationFeature,
  CodeNavigationServerKind
} from '../../../../shared/code-navigation/code-navigation-types'

const USER_ACTION_WINDOW_MS = 1_000

type ActivationModel = Pick<Monaco.editor.ITextModel, 'uri'>
type ActivationEditor = { getModel: () => ActivationModel | null }

function workspaceKey(kind: CodeNavigationServerKind, root: string): string {
  return `${kind}\0${root}`
}

function actionKey(feature: CodeNavigationFeature, modelUri: string): string {
  return `${feature}\0${modelUri}`
}

/** Tracks explicit renderer navigation commands separately from Monaco's passive link queries. */
export class CodeNavigationActivation {
  private readonly activatedWorkspaces = new Set<string>()
  private readonly pendingActions = new Map<string, number>()

  arm(editor: ActivationEditor, feature: CodeNavigationFeature, now: number = Date.now()): void {
    const model = editor.getModel()
    if (model) {
      this.pendingActions.set(actionKey(feature, model.uri.toString()), now + USER_ACTION_WINDOW_MS)
    }
  }

  consume(
    model: ActivationModel,
    feature: CodeNavigationFeature,
    now: number = Date.now()
  ): boolean {
    const key = actionKey(feature, model.uri.toString())
    const expiresAt = this.pendingActions.get(key)
    this.pendingActions.delete(key)
    return expiresAt !== undefined && expiresAt >= now
  }

  activateWorkspace(kind: CodeNavigationServerKind, root: string): void {
    this.activatedWorkspaces.add(workspaceKey(kind, root))
  }

  isWorkspaceActivated(kind: CodeNavigationServerKind, root: string): boolean {
    return this.activatedWorkspaces.has(workspaceKey(kind, root))
  }
}
