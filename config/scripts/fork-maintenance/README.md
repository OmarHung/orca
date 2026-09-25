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

## Local build only

```bash
node config/scripts/fork-maintenance/build-mac-local-arm64.mjs
```

Produces `dist/mac-arm64/Orca.app` (arm64, signed with the local Apple Development identity).
Scripts live here, not in `package.json`, so upstream `package.json` edits never conflict.
