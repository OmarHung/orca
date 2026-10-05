# 舊版 .NET 移進 arm64 容器：實作計畫（fork 專屬）

> 狀態：Phase 0（手動驗證）已完成；Phase 1 的步驟 1～4（launcher、映像、Run 整合、開關）已實作、通過端到端驗證與使用者在 dev 版的實測，並已提交（2026-10-05）。Phase 1 步驟 5～6、Phase 2～4 尚未開工
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 背景與目標

macOS 27 是最後一版通用 Rosetta。現在 `~/.dotnet` 整包是 x86_64（SDK 2.1.818／2.2.207／3.1.426／6.0.136／8.0.419／10.0.201），因為 .NET Core 2.1／2.2／3.1／5.0 沒有 osx-arm64 版本。

專案分布（Web 專案數）：netcoreapp3.1 **237**、2.2 **60**、net6.0 21、2.1 2、net5.0 1、net8 以上 6。

目標：

1. 舊版（< net6.0）的建置、執行、測試、偵錯、發佈改在 **linux/arm64 容器**內進行，**完全不靠 Rosetta**
2. net6 以上留在 Mac 原生 arm64
3. Orca 的 Run、Debug、終端機自動把舊版專案導進容器，使用者不用自己打 `docker exec`

## 2. 已確定的決策

| #   | 決策          | 內容                                                                                                                                                                                                                    |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 容器架構      | `linux/arm64`，不用 amd64＋Rosetta。所有需要的 runtime 都有 linux-arm64 版本，或可以改在 3.1 上執行（見 D4）                                                                                                            |
| D2  | net6 以上     | 留在 Mac 原生 arm64，不進容器                                                                                                                                                                                           |
| D3  | 路徑          | **同路徑掛載**：repo、`~/.nuget`、Orca 的 adapter 目錄，在容器內的絕對路徑和 Mac 上一模一樣；容器內 `HOME=<Mac 的家目錄>`、uid／gid 與 Mac 相同。LSP URI、PDB、中斷點、`X -> path.dll`、deps.json 都不需要轉換路徑      |
| D4  | 2.1／2.2 專案 | 建置時加 `-p:MicrosoftNETPlatformLibrary=Microsoft.NETCore.App -p:CopyLocalLockFileAssemblies=true`，執行時設 `DOTNET_ROLL_FORWARD=Major`，實際跑在 **3.1 arm64 runtime** 上（見 §4）。**待使用者確認**是否接受這個近似 |
| D5  | 基底映像      | `ubuntu:20.04`（OpenSSL 1.1、ICU 66、glibc 2.31）。容器用的 netcoredbg 固定 **3.1.0-1031**，因為 3.1.1 起需要 glibc 2.32，3.2.0 需要 2.38                                                                               |
| D6  | 範圍          | 只作用於本機執行主機。SSH repo 照舊跑遠端的 dotnet；Windows 做不到同路徑掛載，功能限 macOS／Linux；auto 規則只在 darwin-arm64 啟用                                                                                      |
| D7  | 重用          | Docker CLI 共用 ssh-vpn 現有的程式（`src/main/ssh-vpn/ssh-vpn-docker.ts`），抽成共用模組，不另寫一套                                                                                                                    |
| D9  | 網路          | 容器用 `--network host`（Docker Desktop 需開啟 Settings → Resources → Network → Enable host networking，使用者已開啟）。launchSettings 與連線字串裡的 `localhost` 都不用改寫，也不用預先開放 port（見 §3）              |
| D8  | 不在本計畫內  | SQL Server（`mcr.microsoft.com/mssql/server` 只有 amd64，仍依賴 Linux 版 Rosetta）。等 macOS 28 beta 再評估                                                                                                             |

## 3. Phase 0 驗證結果

用 `cma`（3.1）和 `astar`（2.2）兩個 Piranha 專案，各複製一份到暫存目錄驗證，沒有動到原 repo。

| 項目                                                                  | 結果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 建置／執行                                                        | ✅ SDK 10 與 SDK 3.1.426（global.json 鎖定）都能建置。cma 範例啟動時「找不到資料表」，Mac 上的 x64 版出現相同錯誤，屬專案本身問題                                                                                                                                                                                                                                                                                                                                                            |
| 2.1／2.2 原生 arm64                                                   | ❌ **不可行**。runtime 在重負載下崩潰：csc 編譯時 SIGSEGV（`JIT_IsInstanceOfInterface_Portable`），直接執行時 SIGBUS；app 卡住無輸出。單核心、關 tiered／R2R／HW intrinsic、改 GC 設定都無效。另外 ASP.NET Core 2.x 本來就沒有官方 arm64 版本                                                                                                                                                                                                                                                |
| 2.2 跑在 3.1 runtime（D4）                                            | ✅ astar 首頁、`/manager/login` 回 200，4 秒內啟動。`Piranha.Tests`：612 個測試中 598 個通過、14 個失敗，**失敗清單與 Mac 上真正的 2.2 runtime 完全相同**                                                                                                                                                                                                                                                                                                                                    |
| x64 ASP.NET 2.2 shared framework 疊到 3.1 上                          | ❌ x64 ReadyToRun 組件在 arm64 載入時出現 BadImageFormatException，所以改用 D4 的做法                                                                                                                                                                                                                                                                                                                                                                                                        |
| 偵錯（netcoredbg 透過 `docker exec -i` 跑 DAP）                       | ✅ 3.1 和 2.2（在 3.1 上）都在 0.3～0.4 秒內命中中斷點，回報的路徑就是 Mac 上的路徑；結束後偵錯器和被偵錯程式都會退出                                                                                                                                                                                                                                                                                                                                                                        |
| Stop（PTY 內 `docker exec -it`，送 Ctrl-C）                           | ✅ 程式正常關閉，`docker exec` 在 0.1 秒內退出，結束碼 0                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 殺掉 `docker exec` 客戶端                                             | ⚠️ 容器內的程式**仍在執行**（HTTP 200）；`orca-exec --kill <id>` 可以清乾淨。必須有 §5 的 orca-exec                                                                                                                                                                                                                                                                                                                                                                                          |
| Publish（Orca 的 `dotnet publish <proj> -c Release -o <dir>`）        | ✅ astar（2.2）、air（3.1、SDK 10）、unicircus（3.1、global.json 鎖 3.1.426）在兩邊都成功。第三方套件、`runtimeconfig.json`、`web.config` **完全相同**；不同的只有專案自己編譯的 dll／pdb（原始碼路徑寫進去了）和原生 apphost（`web.config` 用 `dotnet xxx.dll` 啟動，不會用到）。唯一實質差異：用 **SDK 3.1 在 Linux 上建置**時，`no`（挪威語）不被視為有效語系，少了 `no/*.resources.dll`；SDK 10 沒有這個問題。cma 範例在兩邊都出現 NETSDK1152（`package.json` 重複輸出），屬專案本身問題 |
| Publish 目的地                                                        | ⚠️ 實際的 profile 會發佈到 repo 外面（例如 air 的 `publishUrl` 是 `../../../../../../Production/Template`），Orca 必須把目的地也掛進容器                                                                                                                                                                                                                                                                                                                                                     |
| 建置速度（冷建置／no-incremental）                                    | ✅ 容器比 Rosetta 快：cma 5.9 秒對 13.3 秒、4.7 秒對 6.7 秒；astar 4.7 秒對 5.2 秒、3.7 秒對 4.3 秒                                                                                                                                                                                                                                                                                                                                                                                          |
| `dotnet watch`                                                        | ✅ 在 Mac 上改檔，容器內的 watch 會偵測到並重啟                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| HTTPS                                                                 | ✅ 匯出 Mac 的開發憑證（`dotnet dev-certs https -ep … -p …`），透過 `ASPNETCORE_Kestrel__Certificates__Default__Path`／`__Password` 提供給容器。Mac 本來就信任這張憑證，curl 不加 `-k` 即可連線                                                                                                                                                                                                                                                                                              |
| launchSettings 的 `localhost` 網址                                    | ✅（host networking）容器內綁 `localhost`、`127.0.0.1`、`0.0.0.0` 的程式，在 Mac 上都能用 `localhost` 連到。Docker 會照原本的綁定範圍對應：綁 127.0.0.1 的程式在 Mac 上也只開在 127.0.0.1。bridge 模式下則連不到（`dotnet run` 會用 `applicationUrl` 蓋掉 `ASPNETCORE_URLS`）                                                                                                                                                                                                                |
| 容器連資料庫（`localhost`）                                           | ✅（host networking）Docker 裡的 SQL Server：`localhost,1433` 用 Microsoft.Data.SqlClient 連線，得到預期的 18456「登入失敗」（故意帶錯帳密），協定完整可用。Mac 原生 PostgreSQL 的 `localhost:5432` 也通（PostgreSQL SSLRequest 有回應），沒人用的 port 會被拒絕。320 個連線字串用 `localhost`，不需要修改                                                                                                                                                                                   |
| 真實網站（air，3.1，連 Mac 原生 MySQL 8.4 arm64 的 `localhost:3306`） | ✅ 照 Orca 的方式在專案目錄 `dotnet run`：首頁 200（標題從資料庫讀出）、`/manager/login` 200、`/sitemap.xml` 200。這個網站在 appsettings 的 Kestrel 設定監聽 50169，log 也不印「Now listening on」，Orca 只能靠掃描 port 發現它（見 Phase 1 第 5 點）                                                                                                                                                                                                                                        |
| 5000 port                                                             | ✅ Mac 的 5000 被 ControlCenter（AirPlay 接收器）占用；容器內綁 `localhost:5000` 後，Mac 上的 `localhost:5000` 會連到 Kestrel。launchSettings 裡有 539 處用 `:5000`                                                                                                                                                                                                                                                                                                                          |

### 3.1 第二輪驗證（Phase 1 設計定案前，2026-10-05）

| 項目                             | 結果                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.x 參數改由 MSBuild 掛載點注入  | ✅ 容器設 `AfterMicrosoftNETSdkTargets=<orca-legacy-aspnet.targets>`，條件為 `$(TargetFramework.StartsWith('netcoreapp2')) And '$(_IsPublishing)' != 'true'`。一般的 `dotnet build／run／test` 就會套用；`dotnet publish` 不套用（SDK 10 會設 `_IsPublishing`），發佈產物不變。`CustomBeforeMicrosoftCommonTargets`、`CustomAfterMicrosoftCommonTargets` 都太早，會被 ASP.NET 2.x 的設定蓋掉 |
| 掛載整個家目錄與 `/Volumes`      | ✅ 搭配 `DOTNET_CLI_HOME=<容器內目錄>`，容器的 dotnet 不會寫入 Mac 的 `~/.dotnet`                                                                                                                                                                                                                                                                                                            |
| **host networking 的 IPv6 問題** | ⚠️ Docker Desktop host networking 下，**IPv6 socket 連 loopback 不可靠**：dual-mode 連 `::ffff:127.0.0.1`、連 `::1` 會被拒絕（連 Docker 已發佈的 port、連外網則正常）；IPv4 socket 一律正常。.NET Core 3.1 的 `TcpClient()`、`HttpClient`、vstest 的 testhost 預設都用 dual-mode，造成 `dotnet test` 失敗。3.1 不支援 `DOTNET_SYSTEM_NET_DISABLEIPV6`（.NET 5 起才有）                       |
| IPv4 shim（`LD_PRELOAD`）        | ✅ 容器內預載一個小函式庫，讓 `socket(AF_INET6, SOCK_DGRAM, …)` 失敗。.NET 用 UDP socket 判斷 `OSSupportsIPv6`，因此對外連線全改走 IPv4（`dotnet test` 恢復 598／14）；Kestrel 綁 `::1` 用 TCP，不受影響，所以 Mac 的 `localhost:5000` 會連到網站，而不是 AirPlay。若連 TCP 也擋，Kestrel 只剩 IPv4，瀏覽器用 `localhost` 會先連到 AirPlay 的 `::1:5000`                                     |
| 偵錯（完整配置下）               | ✅ 中斷點 0.4 秒命中                                                                                                                                                                                                                                                                                                                                                                         |

## 4. 2.1／2.2 專案怎麼跑

- **映像裡不放** 2.x 的 SDK 和 runtime（兩者都會崩潰）。建置一律用 SDK 10，runtime 沒有 2.x，`DOTNET_ROLL_FORWARD=Major` 會讓它往上找到 3.1.32
- **Run／Debug／Test**：套用 `MicrosoftNETPlatformLibrary=Microsoft.NETCore.App`、`CopyLocalLockFileAssemblies=true`。ASP.NET Core 2.x 套件本身以 netstandard2.0 為目標，會以 IL 形式複製到 `bin/`；runtimeconfig 只剩 `Microsoft.NETCore.App`
- **Publish 不套用**：發佈產物是給正式環境的真正 2.2 runtime 用的，不需要在容器內執行
- 這是近似：BCL 是 3.1 而不是 2.2。測試結果目前完全一致，但正式上線前仍要在真正的 2.2 環境驗證（使用者已接受，2026-10-05）
- 不修改專案檔，也不改寫指令：由容器內的 `orca-legacy-aspnet.targets` 透過 `AfterMicrosoftNETSdkTargets` 注入（見 §3.1）

## 5. 映像與容器

映像（Dockerfile 由 Orca 內嵌，tag 用內容 hash，做法與 `ssh-vpn-image.ts` 相同）：

- `ubuntu:20.04` 加上 `ca-certificates curl libicu66 libssl1.1 libgssapi-krb5-2 zlib1g libgdiplus tzdata locales fonts-noto-cjk procps`，並產生 `zh_TW.UTF-8` locale
- 從 `builds.dotnet.microsoft.com` release metadata 取得網址和 sha512，解壓到 `/usr/share/dotnet`：SDK 3.1.426、ASP.NET runtime 5.0.17、SDK 10.0.201。**10.0 必須最後解壓**，因為 `dotnet` 主程式會被後解壓的覆蓋
- 環境變數：`DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false DOTNET_ROLL_FORWARD=Major`
- 建立 `HOME` 目錄並 chown 給 Mac 使用者的 uid／gid；放入 `/usr/local/bin/orca-exec`
- 映像約 2.7 GB；建置時下載 .NET 約需 74 秒

`orca-exec`（容器內的 POSIX sh 腳本）：

- `orca-exec <id> <cmd…>`：如果不是 process group leader，就先 `setsid`。`-t` 模式下 docker exec 已經讓它成為 session leader，不再呼叫 setsid，才能保留 tty 讓 Ctrl-C 有效。然後把 pgid 寫進 `/tmp/orca-exec/<id>.pgid`，再 `exec` 原指令
- `orca-exec --kill <id> [SIG]`：對整個 process group 送訊號，並刪除記錄檔

容器參數：

```
docker run -d --name orca-dotnet-<instanceTag> --platform linux/arm64 --init \
  --cap-add SYS_PTRACE --user <uid>:<gid> \
  -e HOME=<home> -e TZ=<host TZ> -e NUGET_PACKAGES=<home>/.nuget/packages \
  -v <repo root>:<repo root> ...   -v <home>/.nuget:<home>/.nuget \
  -v <userData>/debug-adapters:<userData>/debug-adapters:ro \
  --label dev.orca.dotnet-toolchain --label dev.orca.dotnet-toolchain.instance=<instanceTag> \
  [--network host | -p ...] <image> sleep infinity
```

容器用的 netcoredbg：`https://github.com/Samsung/netcoredbg/releases/download/3.1.0-1031/netcoredbg-linux-arm64.tar.gz`，sha256 `2419a6b34c7d25541a4bca9f140c137bdd6f6a3b5693d2f79bc04c930061ffa3`，大小 3,461,397 bytes。

## 6. Orca 實作分段

### Phase 1：容器管理與 Run 路徑

設計（2026-10-05 定案）：**一個 host 端的 `dotnet` launcher（POSIX sh）**，由 Orca 產生在 `<userData>/dotnet-container/bin/dotnet`（資料夾裡只有它，終端機才能把整個資料夾放上 PATH）。它依目標專案自己決定走容器或原生，並負責叫醒容器；所有判斷邏輯都在這支腳本裡，TS 只負責產生它。

- 為什麼不靠 PATH：Orca 的 shell 整合在使用者 rc 檔**之前**執行，而常見的 `.zshenv`／`.zshrc`（dotnet 官方安裝說明的寫法）會再把 `~/.dotnet` 放到 PATH 最前面，shim 會被蓋掉
- 判斷規則：`ORCA_DOTNET_TOOLCHAIN=container|native` 優先；否則看目標（`--project`、指令中的 `.csproj`／`.sln`，或目前目錄）。往上找 `global.json`，鎖 SDK 2／3／5 就走容器；目標是專案檔就看它的 TFM，是目錄就往下最多 3 層找 csproj（略過 bin／obj／node_modules／.git）。只要有 `netcoreapp*` 或 `net5.0` 就走容器，否則 exec 原生 dotnet
- 容器：單一容器 `orca-dotnet-<instanceTag>`，同路徑掛載家目錄與 `/Volumes`（Linux 只掛家目錄），因此不需要因為新 repo 重建；目錄不在掛載範圍內時明確報錯
- 叫醒：映像不存在就在終端機裡直接 `docker build`（使用者看得到進度）；容器不存在就建立，停止就啟動，映像 tag 不同且沒有執行中的程序就重建
- 執行：`docker exec -i [-t] -w "$PWD" -e <allowlist> <container> orca-exec <id> dotnet "$@"`。只轉送 `ASPNETCORE_*`、`DOTNET_ENVIRONMENT`、名稱含 `__` 的設定變數，以及 `TERM`／`COLORTERM`。docker 以背景執行並 `wait`，收到 HUP／TERM 時呼叫 `orca-exec --kill <id>`，關掉分頁不會留下孤兒程序
- 容器環境：`DOTNET_CLI_HOME`（容器內）、`DOTNET_ROLL_FORWARD=Major`、`AfterMicrosoftNETSdkTargets`（§4）、`LD_PRELOAD`（IPv4 shim，§3.1）、`--network host`、`--cap-add SYS_PTRACE`、uid／gid 與 Mac 相同
- Run 整合：在 `runConfiguration`／`rerunConfiguration` 入口，把指令開頭的 `dotnet` 換成 launcher 的絕對路徑（只限本機執行主機、設定開啟時；冪等）。Stop 送 Ctrl-C 的行為不變

Code review 後的修正（2026-10-05）：

- dash 會在背景指令自己的重導向之前把 stdin 換成 /dev/null，導致 `docker exec -t` 失敗：改成 `exec 3<&0`，再用 `<&3 3<&- &`
- 同時啟動多個（compound）時會競爭建立／替換容器：在 `$TMPDIR/<container>.lock` 用 `mkdir` 上鎖；持有者已不存在，或 6 秒沒寫入 PID，就視為過期的鎖
- 容器是否過期改用 label `dev.orca.dotnet-container.config`（`docker run` 參數的 hash）判斷，不只看映像。是否閒置：先收掉孤兒，再看 `orca-exec --list` 是否還有執行中的 run（Phase 1 原本用 `{{len .ExecIDs}}`，但 client 在 exec 開始前就被殺掉時，那個 exec 會永遠留在清單裡，容器就再也換不掉）
- launcher 被 SIGKILL 時 trap 不會執行：每次啟動時用 `orca-exec --list` 列出 run id（開頭是 launcher 的 PID），用 `ps -p` 確認發起者已經不在的，就以 `--kill` 終止
- global.json 只轉送鎖定 SDK 3 的（映像裡唯一的舊版 SDK 是 3.1.426）
- 顯示 `docker run`／`docker start` 的錯誤原因；macOS 上讀 Docker Desktop 的 `settings-store.json`，host networking 關閉時給出警告
- renderer：先準備 launcher 再讀取 run session（避免連按兩次開出兩個終端機）；PowerShell 用 `& '路徑'`，Nushell 用 `^'路徑'`
- 已知限制：多行指令只轉送第一行開頭的 `dotnet`
- launcher 在 `docker exec` 結束後一律再送一次 `orca-exec --kill <run id>`：偵錯器當掉或 docker client 死掉時，容器裡的程式不會留到下一次啟動才被收掉
- 已知限制：建置時啟動的 Roslyn 編譯伺服器（VBCSCompiler）留在該次執行的 process group 裡，所以 `orca-exec --list` 會繼續把那次執行算成存活，下一次啟動 launcher 時會被一起收掉（只是少了編譯快取，不影響正確性；每次執行結束時的 `--kill` 也會一併收掉它）
- HTTPS 開發憑證（Phase 0 驗證過、Phase 1 原本漏做，使用者實測時發現）：launcher 在 `<userData>/dotnet-container/https/` 用 Mac 原生 dotnet 匯出 `aspnetcore-dev.pfx`（隨機密碼，權限 600，每天重新匯出；憑證和密碼一起替換，匯出失敗就保留舊的一組），再以 `ASPNETCORE_Kestrel__Certificates__Default__Path`／`__Password`（只傳名稱）交給容器。匯出要在憑證資料夾裡執行，因為專案的 global.json 若鎖定 SDK 3.1，它的 `dev-certs` 在 macOS 上會要求 sudo。使用者自己設定了這兩個變數時不覆蓋；憑證資料夾不在掛載範圍內時給出說明。另設 `DOCKER_CLI_HINTS=false`，關掉 docker exec 失敗時的 Docker Debug 廣告

步驟：

1. 把 `resolveDockerPath` 從 `src/main/ssh-vpn/ssh-vpn-docker.ts` 搬到 `src/main/docker/`，ssh-vpn 改用它
2. `src/main/dotnet-container/`：Dockerfile 產生器（pinned URL＋sha512，依 host 架構選 linux-arm64／linux-x64；內嵌 orca-exec、IPv4 shim 原始碼、legacy targets）、launcher 產生器、寫檔（內容不變就不重寫）、IPC 回傳 launcher 路徑
3. 設定開關：`GlobalSettings.dotnetContainerToolchain`，預設關閉（Phase 1 曾放在 renderer 的 localStorage，main 端的偵錯與終端讀不到，已改掉，沒有搬移舊值）
4. Run 入口改寫指令（見上）
5. Port 歸屬（已完成，只認 Docker Desktop 的 forwarder（`com.docker.backend`／vpnkit），不是任何名稱含 container 的程序；`--ports` 用一次 `find` 加一次 `awk`，約 50ms；2026-10-05 用 w31 實測：5000／5001 歸到正確的 workspace，Stop 讓網站正常關閉，Docker 不受影響）：Docker 對外的 port 由 `com.docker.backend` 持有。`orca-exec --ports` 讀容器內的 `/proc/net/tcp*` 與 `/proc/*/fd`，列出監聽中的 port、PID、cwd、指令列；`dotnet-container-ports.ts` 在 macOS、開關打開時，把 Docker 持有的 port 換成容器內程式的 cwd，所以會歸到正確的 workspace（不必靠 PTY 印出的網址）。Stop 對這種 port 改成 `docker exec <容器> kill -TERM <容器內 PID>`，**絕不**對 Docker 的 backend 送訊號（那會把 Docker 關掉）
6. 容器控制（已完成，放在 Run 選單的「.NET Container」子選單，而不是設定頁）：開關、狀態（Docker 未安裝／未啟動、容器不存在／停止／執行中）、在容器中開終端、停止容器、移除容器與映像（只刪 `orca-dotnet:*`）。開關打開時、以及 Orca 啟動時開關已打開，就先安裝 launcher

### Phase 2：偵錯（已完成）

- 映像內建 netcoredbg 3.1.0-1031（`/usr/local/lib/netcoredbg/netcoredbg`；3.1.1 之後需要比 Ubuntu 20.04 新的 glibc），下載網址與 sha256 見 §5，x64 映像用 linux-amd64 版
- `netcoredbg-launch.ts`：開關打開時先判斷目標是否走容器（專案用 launcher 的 `--orca-where`；程式用它旁邊的 `*.runtimeconfig.json`，framework 主版本小於 6 或 TFM 是 `netcoreapp*`／`net5.0` 就走容器），否則完全維持原本的原生流程
- 走容器時：用 launcher 建置（同路徑，輸出解析不用改）、`--orca-ensure` 叫醒容器（失敗時把最後一行錯誤顯示給使用者），再以 `launcher --orca-exec <netcoredbg> --interpreter=vscode` 當 DAP transport。關閉偵錯時 launcher 的 trap 會呼叫 `orca-exec --kill`
- `buildDotnetProject` 改在專案資料夾執行（launcher 要從 cwd 找 global.json）
- launcher 壞掉（安裝失敗、無法執行）時退回原生偵錯，不讓 .NET 6 以後的專案也跟著不能偵錯；apphost（沒有副檔名）也會讀旁邊的 `.runtimeconfig.json`
- 容器過期又還有程式在跑時，`--orca-ensure` 直接失敗並說明原因（舊映像沒有 netcoredbg）
- 驗證（2026-10-05）：`debug-session.netcoredbg-container.integration.test.ts`（設定 `ORCA_TEST_DOTNET_CONTAINER_LAUNCHER`、`ORCA_TEST_DOTNET_CONTAINER_WORKDIR` 才會跑）在 netcoreapp2.1 與 3.1 都能停在中斷點並讀到區域變數，結束後容器內沒有殘留程序

### Phase 3：終端與 agent（已完成，agent 部分待使用者決定）

- 改用 PATH 而不是 shell 函式：開關打開且 launcher 已安裝時，本機終端（不含 WSL、Windows、SSH）的 PATH 最前面放 launcher 資料夾，並設 `ORCA_DOTNET_LAUNCHER_DIR`。launcher 只把舊專案送進容器，其他 `dotnet` 指令照樣交給原生 SDK
- 使用者 rc 檔（以及 macOS 的 path_helper）會把 `~/.dotnet` 放回前面，所以 zsh／bash／fish 的 shell-ready 整合會在 rc 檔之後再把 launcher 資料夾放回第一位（`dotnet-launcher-path-restore.ts`；zsh 在第一個 precmd、bash 在 rcfile 結尾、fish 在 `-C` init 或 vendor_conf 的第一個 fish_prompt）。SSH relay 的 wrapper 不加
- 開關關閉時，也會把 PATH 上任何 launcher 資料夾（包含從另一個 Orca 繼承來的）拿掉
- 沒有升 daemon 協定版本：舊 daemon 仍會把環境變數傳下去，只是在它重啟之前，新分頁少了 rc 檔之後的還原
- 「在容器中開終端」：launcher 的 `--orca-shell`，在目前 worktree 的資料夾開 `bash --noprofile --norc`
- launcher 新增模式：`--orca-where`（印出 container／native）、`--orca-ensure`（只叫醒容器）、`--orca-exec <程式…>`（在容器裡執行任意程式）、`--orca-shell`
- agent：Claude Code 等 agent 自己開的 shell 會讀使用者的 `~/.zshenv`，那裡把 `~/.dotnet` 放在前面。需要在 dotfile 最後加一行 `[ -n "$ORCA_DOTNET_LAUNCHER_DIR" ] && export PATH="$ORCA_DOTNET_LAUNCHER_DIR:$PATH"`（要使用者同意才改）

### Phase 4：Mac 切換成原生 arm64（已備妥，等使用者確認）

- 已安裝在 `~/.dotnet-arm64`：SDK 10.0.201、ASP.NET Core runtime 8.0.25 與 6.0.36
- 切換：`mv ~/.dotnet ~/.dotnet-x64 && mv ~/.dotnet-arm64 ~/.dotnet`，再重新安裝 global tools（dotnet-ef、dotnet-fm、dotnet-gcdump、ilspycmd、security-scan）。要先安裝含 Phase 1–3 的 Orca 版本再切換
- netcoredbg 依 dotnet 執行檔的架構挑版本（`executable-arch.ts`），會自動改抓 osx-arm64 3.2.0；csharp-ls 變成原生執行
- csharp-ls：global.json 鎖 3.1 的 repo 現在（x64）就已經無法載入，切換後一樣，不算退步；其他 repo 在 arm64 上載入較快

## 7. 未決事項與待驗證

1. ~~網路模式~~：已決定採用 host networking（D9）。Orca 啟動容器前要檢查 Docker Desktop 的這個設定，沒開的話要提示使用者
2. **csharp-ls 原生 arm64**（Phase 4 前）：global.json 鎖定 3.1.x 的 repo（titan、unicircus 是 `disable`；quarter-apm2、quarter-monitoring、Quarter.Project3.WebUtilities 是 `latestMinor`），在 Mac 上找不到 3.1 SDK
3. **obj／bin 分流**：改 `BaseIntermediateOutputPath` 會把舊 `obj/` 的產物重複編譯進去（已重現）。若要讓容器與 Mac 的產物分開，必須同時排除 `obj/**`、`bin/**`；否則就維持共用，並設定相同的 `HOME`、`NUGET_PACKAGES`
4. **原生程式庫套件**：DinkToPdf（4）、Grpc.Core（2）、`runtime.osx.10.10-x64.CoreCompat.System.Drawing`（1）、System.Drawing.Common（9，需要 libgdiplus，映像已裝）、EF Core 2.x 的舊 SQLitePCLRaw 是否附 linux-arm64 版本
5. **Data Protection 金鑰**：容器內寫到 `<home>/.aspnet/DataProtection-Keys`，沒有和 Mac 共用；如果需要讓兩邊 cookie 互通，就掛載這個目錄
6. **D4 的近似**是否接受；另一個選擇是 2.x 專案改用 amd64 容器（依賴 Linux 版 Rosetta），或升級成 3.1
