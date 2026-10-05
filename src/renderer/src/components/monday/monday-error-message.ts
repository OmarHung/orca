import { translate } from '@/i18n/i18n'
import type { MondayError } from '../../../../shared/monday/monday-types'

export function mondayErrorMessage(error: MondayError): string {
  switch (error.kind) {
    case 'unauthorized':
      return translate(
        'monday.error.unauthorized',
        'monday rejected the token. Connect again with a new personal API token.'
      )
    case 'daily-limit':
      return translate(
        'monday.error.dailyLimit',
        "Today's monday API limit is used up. Everyone in your monday account shares it; it resets at midnight UTC."
      )
    case 'rate-limited':
      return translate(
        'monday.error.rateLimited',
        'monday is limiting requests right now. Try again in a minute.'
      )
    case 'network':
      return translate(
        'monday.error.network',
        'Could not reach monday. Check your network and try again.'
      )
    case 'not-connected':
      return translate('monday.error.notConnected', 'monday is not connected.')
    case 'api':
      return translate('monday.error.api', 'monday returned an error: {{value0}}', {
        value0: error.message
      })
  }
}
