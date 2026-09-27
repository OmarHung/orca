import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { RunPlanErrorCode } from '../../../../shared/run-configurations/run-configuration-plan'
import type { Resolved } from '../../../../shared/run-configurations/run-configuration-resolve'
import type { RunExit } from './run-configuration-control'

export function planErrorMessage(code: RunPlanErrorCode, reference: string): string {
  switch (code) {
    case 'missing':
      return translate(
        'run.configurations.error.missing',
        "No run configuration named '{{value0}}'",
        {
          value0: reference
        }
      )
    case 'cycle':
      return translate(
        'run.configurations.error.cycle',
        "'{{value0}}' depends on itself through Before launch or a compound",
        { value0: reference }
      )
    case 'step-not-command':
      return translate(
        'run.configurations.error.stepNotCommand',
        "Before launch can only run command configurations; '{{value0}}' is not one",
        { value0: reference }
      )
    case 'multiple-debug':
      return translate(
        'run.configurations.error.multipleDebug',
        "Only one debug session can run at a time; remove '{{value0}}' or run it separately",
        { value0: reference }
      )
  }
}

/** The resolved value, or null after telling the user which variable could not be resolved. */
export function resolvedOrToast<T>(result: Resolved<T>, name: string): T | null {
  if (result.ok) {
    return result.value
  }
  toast.error(
    translate(
      'run.configurations.error.variable',
      "'{{value0}}' uses {{value1}}, which Orca cannot resolve here",
      { value0: name, value1: result.variable }
    )
  )
  return null
}

export function exitFailureMessage(role: 'step' | 'member', name: string, exit: RunExit): string {
  if (role === 'member') {
    return translate(
      'run.configurations.error.memberFailed',
      "'{{value0}}' did not exit with 0, so the rest of the compound was not started",
      { value0: name }
    )
  }
  return exit.status === 'stopped'
    ? translate('run.configurations.error.stepStopped', "Before launch '{{value0}}' was stopped", {
        value0: name
      })
    : translate(
        'run.configurations.error.stepFailed',
        "Before launch '{{value0}}' did not exit with 0 ({{value1}})",
        { value0: name, value1: exit.exitCode ?? '?' }
      )
}
