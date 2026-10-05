// Shell-ready wrapper lines that keep the .NET container launcher first on PATH after the user's
// startup files run: rc files commonly prepend ~/.dotnet, which would hide it. No-ops unless
// ORCA_DOTNET_LAUNCHER_DIR is set (see ipc/pty/host-env/dotnet-container-env.ts).

/** zsh and bash. */
export const DOTNET_LAUNCHER_PATH_RESTORE = `# Why: rc files often prepend ~/.dotnet; the .NET container launcher must stay ahead of it.
[[ -n "\${ORCA_DOTNET_LAUNCHER_DIR:-}" ]] && case "$PATH" in "\${ORCA_DOTNET_LAUNCHER_DIR}"|"\${ORCA_DOTNET_LAUNCHER_DIR}:"*) ;; *) export PATH="\${ORCA_DOTNET_LAUNCHER_DIR}:$PATH" ;; esac`

/** fish, inside a handler that runs at the first prompt (after config.fish). */
export const FISH_DOTNET_LAUNCHER_PATH_RESTORE = `if set -q ORCA_DOTNET_LAUNCHER_DIR; and test "$PATH[1]" != "$ORCA_DOTNET_LAUNCHER_DIR"
    set -gx PATH "$ORCA_DOTNET_LAUNCHER_DIR" $PATH
end`
