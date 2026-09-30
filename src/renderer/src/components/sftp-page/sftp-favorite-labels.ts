import { translate } from '@/i18n/i18n'

/** Add/remove wording for the folder shown. `host` is undefined in a one-list menu and null for the shared list. */
export function currentFolderLabel({
  name,
  host,
  isInList
}: {
  name: string
  host: string | null | undefined
  isInList: boolean
}): string {
  if (host === undefined) {
    return isInList
      ? translate('sftpPage.favorites.removeCurrent', 'Remove “{{name}}” from favorites', { name })
      : translate('sftpPage.favorites.addCurrent', 'Add “{{name}}” to favorites', { name })
  }
  if (host === null) {
    return isInList
      ? translate(
          'sftpPage.favorites.removeCurrentShared',
          'Remove “{{name}}” from favorites for all connections',
          { name }
        )
      : translate(
          'sftpPage.favorites.addCurrentShared',
          'Add “{{name}}” to favorites for all connections',
          { name }
        )
  }
  return isInList
    ? translate(
        'sftpPage.favorites.removeCurrentHost',
        'Remove “{{name}}” from favorites for {{host}}',
        {
          name,
          host
        }
      )
    : translate('sftpPage.favorites.addCurrentHost', 'Add “{{name}}” to favorites for {{host}}', {
        name,
        host
      })
}

export function favoriteListTitle(host: string | null): string {
  return host === null
    ? translate('sftpPage.favorites.sharedList', 'All connections')
    : translate('sftpPage.favorites.hostList', '{{host}} only', { host })
}
