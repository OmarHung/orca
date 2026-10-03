import { runProcess } from '../../shared/child-process/run-process'
import {
  planCommitMessageGeneration,
  type CommitMessagePlan,
  type CommitMessagePlanResult
} from '../../shared/commit-message-plan'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolveLoginShellEnvironment } from '../startup/login-shell-environment'
import {
  commandBackslashMode,
  resolveTextGenerationParams
} from '../text-generation/commit-message-text-generation'
import { cleanGeneratedChangelog } from './fork-update-changelog-prompt'

/** Several releases of notes take longer than a commit message; packaging is the only rival. */
const SUMMARY_TIMEOUT_MS = 4 * 60_000
const ERROR_DETAIL_CHARS = 600

export type ChangelogAgentResult =
  | { ok: true; markdown: string; agentLabel: string }
  | { ok: false; error: string }

/**
 * Plans the headless run with the Source Control AI agent and model the user picked, falling back
 * to Claude when that is not set up: the summary is worth having even without that setting.
 */
export function planChangelogAgent(
  settings: GlobalSettings,
  prompt: string,
  cwd: string
): CommitMessagePlanResult {
  const backslash = commandBackslashMode({ kind: 'local', cwd })
  const resolved = resolveTextGenerationParams(settings)
  if (resolved.ok) {
    const planned = planCommitMessageGeneration({ ...resolved.params, backslash }, prompt)
    if (planned.ok) {
      return planned
    }
  }
  return planCommitMessageGeneration({ agentId: 'claude', model: 'sonnet', backslash }, prompt)
}

function describeFailure(plan: CommitMessagePlan, stderr: string, stdout: string): string {
  const detail = (stderr.trim() || stdout.trim()).slice(-ERROR_DETAIL_CHARS)
  return detail ? `${plan.label} failed: ${detail}` : `${plan.label} failed without output.`
}

export async function runChangelogAgent(
  plan: CommitMessagePlan,
  cwd: string
): Promise<ChangelogAgentResult> {
  const result = await runProcess({
    program: plan.binary,
    args: plan.args,
    cwd,
    // Why the login shell env: a Finder-launched app lacks the terminal's PATH and agent logins.
    env: { ...(await resolveLoginShellEnvironment()), ...plan.env },
    ...(plan.stdinPayload === null ? {} : { input: plan.stdinPayload }),
    timeoutMs: SUMMARY_TIMEOUT_MS
  })
  if (result.timedOut) {
    return {
      ok: false,
      error: `${plan.label} timed out after ${SUMMARY_TIMEOUT_MS / 60_000} minutes.`
    }
  }
  if (result.code !== 0) {
    return { ok: false, error: describeFailure(plan, result.stderr, result.stdout) }
  }
  const markdown = cleanGeneratedChangelog(result.stdout)
  return markdown
    ? { ok: true, markdown, agentLabel: plan.label }
    : { ok: false, error: `${plan.label} returned an empty summary.` }
}
