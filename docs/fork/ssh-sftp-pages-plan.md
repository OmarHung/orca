# SSH 與 SFTP 頁面：實作計畫（fork 專屬）

> 狀態：Phase 1～3（側欄入口與主機清單、SSH 分頁工作區、SFTP 後端）已完成（2026-09-29），紀錄見 §7。Phase 4（SFTP 雙欄 UI）進行中
> 分支：從 `omar/custom` 開 `feat/ssh-sftp-pages`，每個 Phase 完成後合回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 目標

讓 Orca 可以取代 Termius／Royal TSX 當日常的 SSH 和 SFTP 工具。互動方式參考 [omnyssh](https://github.com/timhartmann7/omnyssh)（Apache 2.0，Rust／Tauri，只參考設計，不搬程式碼）：

1. **側欄新增「SSH」和「SFTP」兩個入口**，位置和「任務」「自動化」並列，點下去在主畫面開各自的頁面。
2. **SSH 頁面**：左邊是可搜尋的主機清單；右邊是終端機區，**跟專案工作區一樣有分頁列**，可以點分頁切換，按「＋」選一台主機開新的 SSH 分頁。
3. **SFTP 頁面**：選一台主機後開**雙欄檔案傳輸**（左本機、右遠端），可以多選上傳和下載（包含資料夾），並顯示進度。

使用情境：使用者的 `~/.ssh/config` 大約有 53 台主機，多數是正式機，**遠端沒有安裝 Node.js**。

## 2. 已確定的決策

| # | 決策 | 內容 |
|---|---|---|
| D1 | 頁面形式 | SSH 和 SFTP 各有自己的主畫面頁面，從側欄入口進入。**側欄不直接列主機**，避免把專案清單往下擠 |
| D2 | SSH 終端機位置 | 開在 SSH 頁面自己的分頁列裡，**不是**浮動終端機面板，也不是目前專案的終端機區 |
| D3 | SSH 連線方式 | 在本機 PTY 執行 `ssh <別名>`，照 `~/.ssh/config` 登入。**不走 Orca 的 relay**，所以遠端不需要 Node.js（Orca 設定頁的「連線」會部署 relay，必須有遠端 Node 18+） |
| D4 | 主機來源 | Orca 的 SSH targets（`window.api.ssh.listTargets()`，會自動從 `~/.ssh/config` 同步）。有 `configHost` 的用別名，手動建立的主機用 `ssh -p <port> <user>@<host>` |
| D5 | SFTP 連線方式 | 在 main process 建立**獨立的** ssh2 SFTP session，不經過 relay，也不共用 relay 的 `connectionManager` |
| D6 | 範圍 | 只做桌面版。SSH 分頁**不同步**到手機或 web 客戶端 |
| D7 | 降低 upstream 衝突 | 新程式碼放在新目錄；對 upstream 檔案只做一行等級的掛載點修改；i18n 用 fork 自己的 namespace（`sshPage.*`、`sftpPage.*`），跟 Database 頁一樣 |

## 3. 現有架構（2026-09-29 調查結果）

路徑都相對於 `src/`。

### 3.1 頁面掛載

Database 頁是範本（commit `d820e61fa2`）。它的導航狀態放在 fork 自己的模組裡（`renderer/src/components/database/database-page-navigation.ts`），只呼叫 `setActiveView('database')`。

新頁面最少要改這些 upstream 檔案：

| 檔案 | 改什麼 |
|---|---|
| `shared/ui-chrome-types.ts` | view 型別加 `'ssh' \| 'sftp'` |
| `shared/top-level-view.ts` | 驗證用的完整對照表 |
| `shared/rpc-contract/client-ui-params.ts` | `TopLevelViewSchema` |
| `renderer/src/store/slices/ui/ui-slice-contract-core.ts` | view 清單 |
| `renderer/src/app-shell/AppWorkspaceShell.tsx` | lazy import 和 `ActivePage` 分支 |
| `renderer/src/lib/right-sidebar-visibility.ts` | 右側欄可見性 |
| `renderer/src/components/sidebar/SidebarNav.tsx` | 側欄入口（約 281／400 行，入口元件要另外開檔） |

**不要**照抄 Database 頁在 `use-app-chrome-layout.ts` 裡隱藏左側欄的做法，因為 SSH／SFTP 的入口就在左側欄。

### 3.2 終端機分頁要怎麼放進頁面

- 專案工作區的終端機（`TerminalSplitWorkspaceSurfaces` → `WorktreeSplitSurface`）綁定 `activeWorktreeId`，只在 `activeView === 'terminal'` 時顯示，**不能重用**。
- 浮動終端機面板（`floating-terminal/FloatingTerminalPanelSurface.tsx`）自己組 UI：`<TabBar worktreeId=…>` 加 `<TerminalPane worktreeId=…>`，兩個元件都吃 `worktreeId`。**照這個模式**，換成 SSH 專用的 workspace id。
- 新增 synthetic workspace id `global-ssh-sessions`（放在新檔案，`shared/constants.ts` 已經 300／300 行）。
- 程式碼裡大約有 60 處寫死 `=== FLOATING_TERMINAL_WORKTREE_ID`，沒有共用的判斷函式。新增一個 `isLocalSyntheticWorkspaceId(id)`，在**必要的地方**改成呼叫它（約 20 處，每處一行）：
  - **啟動和關閉的路由**（不改的話 PTY 會啟動失敗）：`lib/terminal-worktree-route.ts`，以及 `worktree-runtime-owner.ts`、`resolved-worktree-execution-host.ts`、`connection-owner-resolution.ts`、`workspace-terminal-host-authority.ts`、`client-creation-action-policy.ts`、`local-preflight-context.ts`、`agent-idle-working-handlers.ts`、`worktree-activation-pty-inventory.ts` 這些只走本機的路由。
  - **保存和還原**（不改的話重啟後分頁會消失）：`workspace-terminal-hydration.ts`、`tabs-session-actions.ts`、`hydrate-editor-session.ts`、`fetch-all-worktrees.ts`、`worktree-slice-lookups.ts`、`terminal-parked-watcher-registry.ts`、`terminal-tab-retirement.ts`、`shared/workspace-session-terminal-buffers.ts`。
  - **排除同步到手機或 web**：`web-session-tabs-sync/tracking-decisions.ts`、`visibility-types.ts`。
  - 只跟浮動面板有關的地方（面板本身、計數、agent 偵測、瀏覽器、markdown）不用改。
- SSH 終端機區要做成 `AppWorkspaceShell` 裡**常駐的隱藏圖層**（像 `TerminalWorkbenchContainer`），不能放在 `ActivePage` 裡。`ActivePage` 切換頁面時會卸載元件，雖然 daemon 的 PTY 會重新接上，但 daemon 關閉時的 fail-open PTY 會重開成空的 shell。

### 3.3 分頁列

- `tab-bar/tab-bar-surface.tsx`：「＋」一律打開下拉選單，`terminalOnly` 模式下選單裡有「New Terminal」，會呼叫 `onNewTerminalTab`。要讓「＋」直接打開主機選擇器，需要在 `tab-bar-props.ts` 加一個選填的 prop。
- 分頁標題的優先順序是 `customTitle` → `quickCommandLabel` → 終端機回報的標題（`shared/tab-title-resolution.ts`）。建立分頁時帶 `quickCommandLabel: 別名`，標題就會固定成主機別名，而且會被保存下來。
- 建立分頁：`createTab(worktreeId, groupId, undefined, { quickCommandLabel })`，再呼叫 `queueTabStartupCommand(tab.id, { command })`。範本是 `lib/run-quick-command-in-new-tab.ts`。

### 3.4 SFTP 現況

- ssh2 的 SFTP 已經有：`SshConnection.sftp()`（`main/ssh/ssh-connection.ts`）。系統 SSH transport 的主機（ProxyJump、ProxyCommand、FIDO2 金鑰）不能用這個方法。
- 已經有不依賴 relay 的函式可以重用：`providers/ssh-filesystem-provider-sftp.ts`（列目錄、stat、fastGet）、`providers/ssh-filesystem-download.ts`（檔案和資料夾下載）、`ssh/sftp-upload.ts`（上傳檔案和資料夾、mkdir、刪除資料夾）、`ssh/system-ssh-sftp-transfer.ts`（用 OpenSSH `sftp` 批次傳輸，給系統 transport 用）。
- **現有的 UI 全部依賴 relay**：右側欄的檔案總管和 `fs:downloadFile` 都走 relay。relay 部署失敗時，`ssh-connect-flow.ts` 會直接斷線，所以遠端沒有 Node 的主機完全無法使用。
- 因此要新增一個 **SFTP session 管理器**：自己建立 `new SshConnection(target, callbacks)`，沿用既有的認證、host key 和 proxy 處理；密碼和 passphrase 提示沿用 `requestSshCredential`（`main/ipc/ssh-connection-state-callbacks.ts`）。

## 4. 設計

### 4.1 SSH 頁面

```
┌ SSH ─────────────────────────────────────────────────────────┐
│ [搜尋目標…        ] │ [FC-Prod ×][demo-1 ×][prod-ti ×]  [＋]    │
│ FC-Prod-35.201…  ●  │                                        │
│ demo-1-34.81…    ●  │  omar@prod-ti:~$ _                     │
│ prod-ti-34.80…      │                                        │
│ …（53 台）          │                                        │
└─────────────────────┴────────────────────────────────────────┘
```

- 左欄：主機清單，重用 `filterSshTargetsBySearchQuery`（`components/settings/ssh-target-search.ts`）。點一下開新的 SSH 分頁；有開啟中分頁的主機會標示出來。
- 右邊：分頁列加上終端機，「＋」打開主機選擇器（可以輸入文字篩選）。
- 啟動指令：`ssh <別名>`，依使用者的 shell 做 quoting（Windows 是 PowerShell）。
- **ssh 結束後**：分頁留著，會回到本機 shell，這樣連線失敗的錯誤訊息看得到。分頁提供「重新連線」，會用保存下來的別名再執行一次 `ssh`。
- **重啟 app**：daemon 還在時 PTY 會接回原本的 session。daemon 不在時（例如重開機）只會還原捲動紀錄加上一個本機 shell，**不會自動重跑 ssh**，改由使用者按「重新連線」。
- **快捷鍵**：Cmd+T／Cmd+W 目前是 window 層級，而且只看 `activeWorktreeId`（`use-terminal-keyboard-shortcuts.ts`、`terminal-workspace-keydown.ts`）。要比照浮動面板加例外，不然在 SSH 頁按快捷鍵會作用到背景裡的專案。

### 4.2 SFTP 頁面

```
┌ SFTP ── 主機：[prod-ti-34.80.114.14 ▾] ─────────────────────────┐
│ 本機  ~/Downloads          │ 遠端  /var/www                    │
│ ☐ report.csv   12 KB       │ ☑ app.log     3 MB                │
│ ☑ build/       —           │ ☐ html/       —                   │
│        [上傳 →]            │           [← 下載]                 │
├────────────────────────────┴───────────────────────────────────┤
│ 傳輸：build/ → /var/www   ███████░░░ 68%   [取消]                │
└────────────────────────────────────────────────────────────────┘
```

- main：`main/sftp/` 放 session 管理器（每台主機一條連線，閒置一段時間後關閉），IPC 提供 list、stat、download、upload、mkdir、rename、remove、cancel，傳輸進度用事件推送。還要補 preload 型別和 web 版的 stub。
- 系統 transport 的主機第一版顯示「這台主機的連線方式暫不支援 SFTP」。使用者目前的 config 沒有 ProxyJump，影響不大。之後可以用 `system-ssh-sftp-transfer.ts` 補上。
- UI 第一版的預設範圍（**待使用者確認**）：
  - 必做：雙欄瀏覽、多選、上傳和下載（包含資料夾）、進度條
  - 建議加：從 Finder 拖放上傳、取消進行中的傳輸、新增資料夾、重新命名
  - 刪除遠端檔案：要二次確認，因為多數是正式機

## 5. 分階段

| Phase | 內容 | 驗收 |
|---|---|---|
| 1 | 側欄入口、SSH 和 SFTP 空頁面、SSH 主機清單和搜尋 | 點入口能開頁面；左側欄仍然在；主機清單可以篩選 |
| 2 | SSH 工作區：synthetic id、約 20 處路由和保存的修改、常駐圖層、分頁列、「＋」主機選擇器、別名標題、快捷鍵例外、重新連線 | 開 3 台主機的分頁可以來回切換；切到別的頁面再回來，session 還在；重啟 app 後分頁還在 |
| 3 | SFTP main 端：session 管理器和 IPC（先寫測試） | 單元測試涵蓋列目錄、上傳、下載、取消、認證失敗 |
| 4 | SFTP 雙欄 UI | 實際對一台主機上傳和下載檔案與資料夾，進度正確 |

每個 Phase 都要通過：`pnpm tc`、相關測試、`pnpm run check:code-quality:changed`（不能新增問題）、i18n 驗證、行數上限。完成後打包安裝給使用者實際試用。

## 6. 風險

- **Rebase 衝突**：約 20 處 upstream 檔案要改一行。每處都只把 `=== FLOATING_TERMINAL_WORKTREE_ID` 換成呼叫判斷函式，把衝突面積壓到最小。
- **行數上限**：`shared/constants.ts`（300／300）、`local-preflight-context.ts`（約 293／300）、`use-global-keybindings.ts`（約 281／300）已經接近上限，新的程式碼要另外開檔。
- **沒改到的特例**：其餘約 40 處特例對新的 id 可能會有預期外的行為。Phase 2 要實際測試：切換頁面、重啟、關閉分頁、配對手機時的行為。
- **正式機安全**：SFTP 的刪除和覆寫都要確認；上傳遇到同名檔案時預設詢問，不直接覆蓋。

## 7. 完成紀錄

### 7.1 Phase 1（2026-09-29）

- 側欄入口：`components/ssh-page/SshSidebarNavEntries.tsx`，樣式照抄「自動化」項目，在 `SidebarNav.tsx` 裡加一行掛載。**沒有做「從側欄隱藏」**，因為那需要新增 GlobalSettings 的 key，會動到上游的設定型別。
- 頁面：`components/ssh-page/SshPage.tsx`、`components/sftp-page/SftpPage.tsx`，共用 `RemoteHostsPageFrame`（標題列和「僅限桌面版」的提示）。
- 主機清單：`SshHostListPanel` 負責載入中、錯誤、空清單三種狀態；`SshHostList` 負責搜尋和清單列。搜尋重用 `settings/ssh-target-search.ts` 的 `filterSshTargetsBySearchQuery`，`user@host:port` 抽成共用的 `formatSshTargetEndpoint`。
- `use-ssh-target-list.ts`：打開頁面時先執行 `importConfig()`（跟 SSH 設定頁一樣的被動同步），再呼叫 `listTargets()`。同步失敗時照樣列出已知的主機。
- 上游修改：§3.1 表格裡的 6 個檔案，加上 `SidebarNav.tsx`。
- 目前點主機只會標示為選取；SSH 分頁是 Phase 2 的範圍，SFTP 頁顯示「下一次更新推出」。
- i18n：`sshPage.*`、`sftpPage.*`，放在 en.json 和 zh.json 的最上層，zh-TW 由產生器轉出。

### 7.2 Phase 2（2026-09-29）

- **Synthetic workspace**：`shared/local-synthetic-workspace.ts` 定義 `SSH_SESSIONS_WORKTREE_ID = 'global-ssh-sessions'`、`isLocalSyntheticWorkspaceId()`、`addLocalSyntheticWorkspaceIds()`。
- **上游一行修改（19 個檔案）**：本機路由（`terminal-worktree-route`、`worktree-runtime-owner` ×2、`resolved-worktree-execution-host`、`connection-owner-resolution`、`workspace-terminal-host-authority`、`client-creation-action-policy`、`local-preflight-context` ×2、`agent-idle-working-handlers`、`worktree-activation-pty-inventory`）；保存還原（`workspace-terminal-hydration`、`tabs-session-actions`、`fetch-all-worktrees`、`worktree-slice-lookups`、`terminal-parked-watcher-registry`）；排除手機/web 同步（`visibility-types`、`tracking-decisions`、`apply-snapshot`）；`workspace-launch-kind`；`http-link-routing`（不改的話在 SSH 終端機點網址會把 SSH 工作區設成 active worktree）。
- **刻意不改的特例**：`terminal-startup-cwd`（不認識的 workspace 會退回 provider 預設 cwd，也就是家目錄，SSH 正好需要這個）、editor／browser 的 hydration（SSH 工作區沒有這兩種分頁）、quick commands、agent 偵測、codex、session fork、`retainHiddenWebgl`（對不存在的 repo 查詢本來就回傳 null）、main process 的 runtime（桌面版專用，不同步）。
- **其他上游修改**：
  - `tab-bar-props.ts`／`tab-bar-surface.tsx`：選填的 `onNewTabClick`，設定後「＋」不開選單，直接呼叫它。
  - `FloatingWorkspaceTabDragContext.tsx`：選填的 `worktreeId`，讓 SSH 頁重用分頁拖曳。
  - `terminal-workspace-keydown.ts`：`activeView === 'ssh'` 時直接返回，讓背景的專案不會接到 Cmd+T、Cmd+W。
- **UI**：`SshPageHost`（掛在 `AppWorkspaceShell`，第一次開啟後常駐、切走時只用 CSS 隱藏）→ `SshPage`（主機清單 + `SshSessionsSurface` + `SshHostPickerDialog`）。`use-ssh-session-items.ts` 是浮動面板 items hook 的純終端機版本。`use-ssh-page-shortcuts.ts` 處理 Cmd+T（開主機選擇）和 Cmd+W（關目前分頁）。
- **啟動指令**：`ssh-session-command.ts` 只接受安全字元，而且不能以 `-` 開頭（防止 `-oProxyCommand=…` 注入）。有別名時用別名，否則用 `ssh -p <port> <user>@<host>`。
- **跟 §4.1 不同的地方**：沒有做獨立的「重新連線」按鈕。目前沒有 API 可以把文字寫進已經存在的終端機，所以重新連線的方式是在左邊清單再點一次主機（開一個新分頁，舊分頁保留斷線前的輸出）。
- **驗證**：單元測試（指令組合、開啟/關閉動作、Cmd+T 在 SSH 頁不作用到專案、主機清單、判斷函式）；回歸測試（lib、store、runtime、terminal-pane、floating-terminal、tab-bar，約 2600 個測試檔）；E2E `tests/e2e/ssh-page-sessions.spec.ts`：連到 `127.0.0.1:9`（Connection refused，不會對外連線），驗證 PTY id 帶 `global-ssh-sessions@@` 前綴、離開頁面再回來 PTY 不變、「＋」選主機開第二個分頁、重啟後分頁還原。

### 7.3 Phase 2 之後的版面調整（2026-09-29，使用者在 dev 版試用後提出）

- 拿掉兩個頁面的標題區（`RemoteHostsPageFrame` 只剩「僅限桌面版」的判斷），頁面名稱由側欄入口表示。
- 主機清單可以收合，狀態依頁面分別存在 localStorage（`remote-hosts-layout-store.ts`，key `orca.remoteHostsLayout`）。
- SSH 頁的分頁列移到最上方當標題列：`AppWorkspaceShell` 的 stacked titlebar 對 `'ssh'` 不顯示（跟 automations、artifacts 一樣）；分頁列加上 `data-terminal-focus-release-surface`（可以拖曳視窗）和 `window-controls-titlebar-spacer`。主機清單移到分頁列下方，收合鈕固定在分頁列最左邊。側欄收合時仍然會出現完整的標題列（跟 Tasks 頁一樣），要做到跟專案完全一樣需要改 `use-app-chrome-layout`，這次沒有做。

### 7.4 Phase 3：SFTP 後端（2026-09-29）

- `main/sftp/`：
  - `sftp-ops.ts`：窄介面 `SftpOps`（ssh2 的 `SFTPWrapper` 直接符合），加上 promise 版的呼叫。測試用 `sftp-test-support.ts` 的記憶體版 `FakeSftp`。
  - `sftp-transfer.ts`：規劃和執行傳輸。下載時跟隨指向檔案的連結、跳過指向資料夾的連結（避免迴圈）；上傳用 `lstat`，不跟隨任何本機連結（避免把沒選到的檔案傳出去）；遠端名稱含 `/` 或是 `.`、`..` 時略過。**下載先寫到 `<name>.orca-download` 再改名**，所以失敗時不會截斷使用者原本的檔案。上傳失敗時不刪遠端檔案，避免誤刪原檔。
  - `sftp-session-manager.ts`：每台主機一條**獨立的** `SshConnection`（`onStateChange` 不廣播，避免設定頁的連線狀態誤判），瀏覽共用一個 SFTP 通道，每次傳輸開自己的通道（取消就是關掉它），閒置 5 分鐘斷線，系統 SSH transport 的主機回報不支援。重名衝突在 `overwrite: false` 時只回報、不覆蓋。進度每 100ms 最多推送一次。
  - `sftp-remote-entries.ts`：列目錄（資料夾在前、自然排序）和遞迴刪除（`lstat`，連結只刪連結本身）。
  - `sftp-local-fs.ts`：本機窗格的唯讀列目錄。
  - `sftp-ipc.ts`／`sftp-ipc-schemas.ts`：`sftp:*` IPC，用 zod 驗證（遠端路徑必須以 `/` 開頭、本機路徑必須是絕對路徑、不接受多餘欄位），進度用 `sftp:progress` 廣播。
- Preload：`preload/api/sftp-api.ts`、`sftp-bridge.ts`（含 `webUtils.getPathForFile`，給從 Finder 拖放用）。web 版由 `withFallback` 補上，不需要 stub。
- 上游修改：`preload/index.ts`、`preload/api-types.ts`、`register-core-handlers.ts`（各加一行），以及它的測試補上 mock。
