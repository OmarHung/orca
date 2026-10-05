import { formatPosixCommand } from '../../shared/ssh-vpn-command-format'
import { ORCA_EXEC_PATH } from './dotnet-container-assets'
import { DOTNET_CONTAINER_CONFIG_LABEL } from './dotnet-container-run'

/** Launcher functions that export the Mac's development certificate for Kestrel. */
export function httpsCertificateFunctions(): string {
  return `# Why: Kestrel's HTTPS endpoints need the development certificate, which lives in the Mac's
# keychain. The Mac already trusts it, so browsers accept what the container serves.
orca_prepare_https() {
  [ -z "\${ASPNETCORE_Kestrel__Certificates__Default__Path:-}" ] || return 0
  if ! orca_inside_mounts "$orca_cert_dir"; then
    printf 'orca: %s is not shared with the .NET container, so HTTPS endpoints have no certificate\\n' "$orca_cert_dir" >&2
    return 0
  fi
  orca_cert="$orca_cert_dir/aspnetcore-dev.pfx"
  # Why daily: dotnet dev-certs renews the Mac's certificate, and the copy has to follow it.
  if [ ! -f "$orca_cert" ] || [ -n "$(find "$orca_cert" -mtime +0 2>/dev/null)" ]; then
    orca_export_https_certificate
  fi
  if [ ! -f "$orca_cert" ]; then
    printf 'orca: could not export the HTTPS development certificate; HTTPS endpoints fail until "dotnet dev-certs https --trust" is run on this machine\\n' >&2
    return 0
  fi
  ASPNETCORE_Kestrel__Certificates__Default__Path=$orca_cert
  ASPNETCORE_Kestrel__Certificates__Default__Password=$(cat "$orca_cert_dir/password")
  export ASPNETCORE_Kestrel__Certificates__Default__Path ASPNETCORE_Kestrel__Certificates__Default__Password
}

# Replaces the certificate and its password together, so a failed export keeps the old pair.
orca_export_https_certificate() {
  orca_dev_certs=$(orca_native_dotnet) || return 1
  (
    umask 077
    # Why cd: a project's global.json can pin SDK 3.1, whose dev-certs wants sudo on macOS.
    mkdir -p "$orca_cert_dir" &&
      cd "$orca_cert_dir" &&
      od -An -N16 -tx1 /dev/urandom | tr -d ' \\n' > "$orca_cert_dir/password.new" &&
      "$orca_dev_certs" dev-certs https --export-path "$orca_cert.new" --password "$(cat "$orca_cert_dir/password.new")" >/dev/null 2>&1 &&
      mv "$orca_cert_dir/password.new" "$orca_cert_dir/password" &&
      mv "$orca_cert.new" "$orca_cert"
  )
}
`
}

/** Launcher functions that create, start, replace and clean up the shared container. */
export function containerLifecycleFunctions(runArgs: readonly string[]): string {
  const runCommand = `"$orca_docker" ${formatPosixCommand(runArgs)}`
  return `orca_warn_host_networking() {
  if [ -n "$orca_docker_settings" ] && grep -Eqs '"HostNetworkingEnabled"[[:space:]]*:[[:space:]]*false' "$orca_docker_settings"; then
    printf 'orca: Docker Desktop host networking is off, so localhost URLs and databases will not connect. Turn it on in Docker Desktop: Settings > Resources > Network.\\n' >&2
  fi
}

# Why a lock: compound runs start several launchers at once, and only one may create or replace.
orca_lock() {
  orca_waited=0
  orca_ownerless=0
  until mkdir "$orca_lock_dir" 2>/dev/null; do
    orca_holder=$(cat "$orca_lock_dir/pid" 2>/dev/null) || orca_holder=
    if [ -z "$orca_holder" ]; then orca_ownerless=$((orca_ownerless + 1)); else orca_ownerless=0; fi
    # Why: a launcher killed while holding the lock (or before naming itself) must not block later runs.
    if [ "$orca_ownerless" -gt 5 ] || { [ -n "$orca_holder" ] && ! ps -p "$orca_holder" >/dev/null 2>&1; }; then
      rm -rf "$orca_lock_dir"
      continue
    fi
    orca_waited=$((orca_waited + 1))
    [ "$orca_waited" -le 900 ] || orca_fail "timed out waiting for another run to prepare the .NET container (remove $orca_lock_dir if none is starting)"
    sleep 1
  done
  # Why exit on signals: dash skips the EXIT trap when a signal ends the shell.
  trap 'exit 130' HUP INT TERM
  trap 'rm -rf "$orca_lock_dir"' EXIT
  echo "$$" > "$orca_lock_dir/pid"
}

orca_unlock() {
  rm -rf "$orca_lock_dir"
  trap - EXIT
}

orca_container_state() {
  "$orca_docker" container inspect --format '{{.State.Running}} {{index .Config.Labels "${DOTNET_CONTAINER_CONFIG_LABEL}"}}' "$orca_container" 2>/dev/null
}

# Why not {{len .ExecIDs}}: an exec whose client died before it started stays listed forever.
orca_busy() {
  [ -n "$("$orca_docker" exec "$orca_container" ${ORCA_EXEC_PATH} --list 2>/dev/null)" ]
}

# Why: a launcher killed outright (SIGKILL, a crash) never runs its trap, so its program would
# keep running and holding its port. Run IDs start with the launcher's PID.
orca_reap_orphans() {
  for orca_id in $("$orca_docker" exec "$orca_container" ${ORCA_EXEC_PATH} --list 2>/dev/null); do
    ps -p "\${orca_id%%.*}" >/dev/null 2>&1 || "$orca_docker" exec "$orca_container" ${ORCA_EXEC_PATH} --kill "$orca_id" >/dev/null 2>&1
  done
}

orca_create_container() {
  if ! "$orca_docker" image inspect "$orca_image" >/dev/null 2>&1; then
    printf 'orca: building the .NET container image; the first time takes a few minutes\\n' >&2
    "$orca_docker" build --platform "$orca_platform" --tag "$orca_image" - < "$orca_dockerfile" >&2 ||
      orca_fail 'could not build the .NET container image'
  fi
  orca_error=$(${runCommand} 2>&1 >/dev/null) || orca_fail "could not start the .NET container: $orca_error"
}

orca_prepare_container() {
  orca_state=$(orca_container_state) || orca_state=
  case "$orca_state" in
    true\\ *) orca_reap_orphans ;;
  esac
  case "$orca_state" in
    "true $orca_config") return 0 ;;
    "false $orca_config")
      orca_error=$("$orca_docker" start "$orca_container" 2>&1 >/dev/null) || orca_fail "could not start the .NET container: $orca_error"
      return 0
      ;;
    true\\ *)
      if orca_busy; then
        # Why: debugging runs netcoredbg, which an older image may not have.
        [ "$orca_mode" != ensure ] || orca_fail 'the .NET container is out of date and still running programs; stop them (or Stop Container in the Run menu) and try again'
        printf 'orca: the .NET container is out of date; it is replaced once the programs running in it exit\\n' >&2
        return 0
      fi
      "$orca_docker" rm --force "$orca_container" >/dev/null 2>&1
      ;;
    ?*) "$orca_docker" rm --force "$orca_container" >/dev/null 2>&1 ;;
  esac
  orca_create_container
}
`
}
