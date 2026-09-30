import { Fragment } from 'react'
import { Folder, Star, StarOff, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useSftpFavoriteFolders, type SftpFavoriteList } from './sftp-favorite-folders'
import { currentFolderLabel, favoriteListTitle } from './sftp-favorite-labels'

const NO_FOLDERS: readonly string[] = []

type ShownList = SftpFavoriteList & { folders: readonly string[] }

/** Folders of every non-empty list, headed by the list's name when the menu has several. */
function FavoriteSections({
  lists,
  renderFolder
}: {
  lists: readonly ShownList[]
  renderFolder: (list: ShownList, folder: string) => React.JSX.Element
}): React.JSX.Element {
  const isGrouped = lists.length > 1
  const shown = lists.filter((list) => list.folders.length > 0)
  if (shown.length === 0) {
    return (
      <DropdownMenuItem disabled>
        {translate('sftpPage.favorites.empty', 'No favorite folders yet')}
      </DropdownMenuItem>
    )
  }
  return (
    <>
      {shown.map((list) => (
        <Fragment key={list.scope}>
          {isGrouped ? <DropdownMenuLabel>{favoriteListTitle(list.host)}</DropdownMenuLabel> : null}
          {list.folders.map((folder) => renderFolder(list, folder))}
        </Fragment>
      ))}
    </>
  )
}

/** Pane toolbar menu: keeps the folder shown as a favorite and jumps to any favorite. */
export function SftpFavoriteFoldersMenu({
  lists,
  path,
  folderName,
  onNavigate
}: {
  /** The first list is the one a single-list menu adds to. */
  lists: readonly SftpFavoriteList[]
  path: string | null
  folderName: (path: string) => string
  onNavigate: (path: string) => void
}): React.JSX.Element {
  const foldersByScope = useSftpFavoriteFolders((s) => s.foldersByScope)
  const add = useSftpFavoriteFolders((s) => s.add)
  const remove = useSftpFavoriteFolders((s) => s.remove)
  const shownLists = lists.map((list) => ({
    ...list,
    folders: foldersByScope[list.scope] ?? NO_FOLDERS
  }))
  const isGrouped = shownLists.length > 1
  const hasFavorites = shownLists.some((list) => list.folders.length > 0)
  const isFavorite = path !== null && shownLists.some((list) => list.folders.includes(path))
  const label = translate('sftpPage.favorites.menu', 'Favorite folders')

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={label}>
              <Star
                data-favorite={isFavorite ? 'true' : undefined}
                className="size-3.5 data-[favorite=true]:fill-current"
              />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        {path === null
          ? null
          : shownLists.map((list) => {
              const isInList = list.folders.includes(path)
              return (
                <DropdownMenuItem
                  key={list.scope}
                  onSelect={() => (isInList ? remove(list.scope, path) : add(list.scope, path))}
                >
                  {isInList ? <StarOff /> : <Star />}
                  <span className="truncate">
                    {currentFolderLabel({
                      name: folderName(path),
                      host: isGrouped ? list.host : undefined,
                      isInList
                    })}
                  </span>
                </DropdownMenuItem>
              )
            })}
        <DropdownMenuSeparator />
        {isGrouped && hasFavorites ? null : <DropdownMenuLabel>{label}</DropdownMenuLabel>}
        <FavoriteSections
          lists={shownLists}
          renderFolder={(list, folder) => (
            <DropdownMenuItem
              key={folder}
              data-sftp-favorite={folder}
              data-sftp-favorite-scope={list.scope}
              title={folder}
              onSelect={() => onNavigate(folder)}
            >
              <Folder />
              <div className="min-w-0 flex-1">
                <div className="truncate">{folderName(folder)}</div>
                <div className="truncate text-[11px] text-muted-foreground">{folder}</div>
              </div>
            </DropdownMenuItem>
          )}
        />
        {hasFavorites ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trash2 />
                {translate('sftpPage.favorites.removeMenu', 'Remove a favorite')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <FavoriteSections
                  lists={shownLists}
                  renderFolder={(list, folder) => (
                    <DropdownMenuItem
                      key={folder}
                      title={folder}
                      onSelect={() => remove(list.scope, folder)}
                    >
                      <Folder />
                      <span className="truncate">{folderName(folder)}</span>
                    </DropdownMenuItem>
                  )}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
