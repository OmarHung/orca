// Files baked into the .NET container image; see docs/fork/dotnet-container-toolchain-plan.md.

export const ORCA_EXEC_PATH = '/usr/local/bin/orca-exec'
export const IPV4_ONLY_LIBRARY_PATH = '/usr/local/lib/orca-ipv4only.so'
export const LEGACY_ASPNET_TARGETS_PATH = '/usr/local/share/orca/orca-legacy-aspnet.targets'
/** The image unpacks netcoredbg's archive (a `netcoredbg/` folder) into /usr/local/lib. */
export const CONTAINER_NETCOREDBG_PATH = '/usr/local/lib/netcoredbg/netcoredbg'

/** Records each run's process group: `docker exec` leaves the program running when its client dies. */
export const ORCA_EXEC_SCRIPT = `#!/bin/sh
# orca-exec RUN_ID CMD...        run CMD as its own process group, recorded for --kill
# orca-exec --kill RUN_ID [SIG]  signal that group
# orca-exec --list               print the RUN_IDs whose group is still alive
# orca-exec --ports              print listening TCP ports: port, pid, cwd, command line (tab-separated)
set -eu
STATE=/tmp/orca-exec
case "\${1:-}" in
  --kill)
    f="$STATE/$2.pgid"
    [ -f "$f" ] || exit 0
    kill -s "\${3:-TERM}" -- "-$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
    exit 0
    ;;
  --list)
    for f in "$STATE"/*.pgid; do
      # Why read once: a concurrent --kill can remove the file between a test and a read.
      pgid=$(cat "$f" 2>/dev/null) || continue
      if kill -s 0 -- "-$pgid" 2>/dev/null; then basename "$f" .pgid; else rm -f "$f"; fi
    done
    exit 0
    ;;
  --ports)
    # Why here: on Docker Desktop the Mac only sees the VM's forwarder, not the program behind a port.
    # Why one find and one awk: a readlink per open file is thousands of forks per scan.
    find /proc/[0-9]*/fd -lname 'socket:*' -printf '%l %h\\n' 2>/dev/null |
      awk 'FILENAME == "-" { split($2, d, "/"); owner[$1] = d[3]; next }
        FNR > 1 && $4 == "0A" { split($2, a, ":"); s = "socket:[" $10 "]"; if (s in owner) print a[2], owner[s] }' \
        - /proc/net/tcp /proc/net/tcp6 2>/dev/null |
      while read -r hex pid; do
        printf '%d\\t%s\\t%s\\t%s\\n' "0x$hex" "$pid" "$(readlink "/proc/$pid/cwd" 2>/dev/null || true)" \
          "$(tr '\\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      done
    exit 0
    ;;
esac
id=$1
shift
mkdir -p "$STATE"
# With -t, docker exec already made us session leader; keep the tty so Ctrl-C reaches CMD.
if [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then exec setsid "$0" "$id" "$@"; fi
echo $$ > "$STATE/$id.pgid"
exec "$@"
`

/**
 * Docker Desktop host networking refuses IPv6 loopback connects, and .NET Core 3.1 dials loopback
 * dual-mode with no DOTNET_SYSTEM_NET_DISABLEIPV6. Failing only IPv6 UDP sockets makes .NET's
 * OSSupportsIPv6 probe say no (so clients use IPv4) while Kestrel can still bind ::1.
 */
export const IPV4_ONLY_SOURCE = `#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <sys/socket.h>

int socket(int domain, int type, int protocol) {
  static int (*real_socket)(int, int, int);
  if (domain == AF_INET6 && (type & 0xf) == SOCK_DGRAM) {
    errno = EAFNOSUPPORT;
    return -1;
  }
  if (!real_socket) {
    real_socket = (int (*)(int, int, int))dlsym(RTLD_NEXT, "socket");
  }
  return real_socket(domain, type, protocol);
}
`

/**
 * ASP.NET Core 2.x has no arm64 build and the 2.x runtime crashes there, so run and test such
 * apps on 3.1 with their ASP.NET packages copied locally. Publishing keeps the real 2.x output.
 * Imported through AfterMicrosoftNETSdkTargets: earlier hooks are overridden by ASP.NET's own props.
 */
export const LEGACY_ASPNET_TARGETS = `<Project>
  <PropertyGroup Condition="$(TargetFramework.StartsWith('netcoreapp2')) And '$(_IsPublishing)' != 'true'">
    <MicrosoftNETPlatformLibrary>Microsoft.NETCore.App</MicrosoftNETPlatformLibrary>
    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
  </PropertyGroup>
</Project>
`
