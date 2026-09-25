# Fork maintenance (OmarHung/orca)

This fork carries its own commits on top of upstream (`stablyai/orca`) releases.

| Branch        | Role                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `main`        | Mirror of upstream `main`. Never commit here.                        |
| `omar/custom` | Upstream release tag + this fork's commits. Use and build from this. |
| `feat/*`      | New work, branched from `omar/custom` and merged back.               |

Remotes: `origin` = upstream, `fork` = `https://github.com/OmarHung/orca.git`.
`git rerere` is enabled locally so repeated conflict resolutions replay automatically.

## Following a new upstream release

```bash
git switch omar/custom
node config/scripts/fork-maintenance/sync-upstream.mjs v1.4.212 --push --build
```

This backs up the branch (`backup/omar-custom-<old tag>`), rebases the fork's commits onto the
new tag, runs `pnpm install --frozen-lockfile`, `pnpm tc` and focused tests, then with `--push`
force-with-lease pushes `omar/custom` and fast-forwards the fork's `main`, and with `--build`
builds the local app.

On a conflict it stops. Resolve, `git add`, `git rebase --continue`, then re-run the same command:
an already-rebased branch is only verified, pushed, and built.

## From the app

A build made by `build-mac-local-arm64.mjs` stamps `orcaForkSource` (this checkout, branch, base
tag) into its package.json. That build never offers official releases. Its update card instead
reports a newer upstream release tag, and **Sync & update** runs
`sync-upstream.mjs <tag> --push --build --auto-worktree --events`, then installs the result through
Orca's local-build installer (one confirmation dialog, then restart).

`--auto-worktree` runs in whichever worktree has `omar/custom` checked out, creating
`<checkout>-omar-custom` beside this one if none does, so the checkout you develop in is untouched.
On a conflict the rebase is aborted (branch unchanged) and the card lists the files, with
**Resolve with AI** (opens an agent in that worktree with the exact rebase to redo) and **Retry**.
Code: `src/main/fork-source-update/`.

## Local build (Apple Silicon)

### Prerequisites

- An Apple Silicon Mac with Xcode Command Line Tools (`xcode-select --install`), Node, and pnpm.
- An **Apple Development** signing identity in your keychain (Xcode → Settings → Accounts). The
  build signs with it; the in-app installer only accepts a build with the same valid signature.
- Dependencies installed: `pnpm install`.

### Build

```bash
git switch omar/custom        # build what you run; the app records this branch and base tag
node config/scripts/fork-maintenance/build-mac-local-arm64.mjs
```

It runs `pnpm run build:desktop` (typecheck + app bundles), builds the native Swift helpers,
then packages with electron-builder. Takes about 10 minutes. Output in `dist/`:

| File                                             | Use                                             |
| ------------------------------------------------ | ----------------------------------------------- |
| `mac-arm64/Orca.app`                             | The app.                                        |
| `Orca-<version>-arm64-mac.zip`, `latest-mac.yml` | What Orca's in-app local-build installer reads. |

The version is `<package version>-local.<timestamp>.<commit>`, and package.json carries
`orcaForkSource` so the app updates by syncing this fork (see "From the app").

### Install

First time, or to replace a build by hand: quit Orca (⌘Q), drag `dist/mac-arm64/Orca.app` onto
`/Applications`, reopen. Terminal sessions survive; the terminal daemon is a separate process.
Afterwards, updates come from the app's update card.

Alternative without quitting first: ⌥-click **Check for Updates** and choose `dist/latest-mac.yml`.

Check it took: **Check for Updates** should say you are on the latest version (a non-fork build
would instead offer the official release).

### Why not `pnpm build:mac`

This script differs in three ways, each for a problem hit on this machine:

- **Native helpers build arm64 only** (`--single-arch`). These Command Line Tools ship arm64-only
  Swift libraries, so the default arm64 + x86_64 universal link fails with
  `Undefined symbols for architecture x86_64`.
- **Packages `--mac zip --arm64` only**: no DMG, no x64 slice, so `pnpm install:release` is not
  needed.
- **Reuses `node_modules/electron/dist`** instead of downloading Electron from GitHub, which
  stalled until electron-builder's 10-minute timeout (`Timeout awaiting 'request'`).

### Troubleshooting

- `lipo: same architectures (arm64) found`: a stale universal binary is in the Swift build cache.
  Delete `native/computer-use-macos/.build/x86_64-apple-macosx` and rebuild.
- `node_modules/electron/dist is X, expected Y`: run `pnpm install`.
- Signing errors: confirm the identity with `security find-identity -v -p codesigning`.

Scripts live here, not in `package.json`, so upstream `package.json` edits never conflict.
