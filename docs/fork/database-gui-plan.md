# Database 工具（DataGrip 風格）：實作計畫（fork 專屬）

> 狀態：計畫中，尚未開工（2026-09-27）
> 分支：從 `omar/custom` 開 `feat/database`，每個 Phase 完成後合回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 目標

在 Orca 裡做出接近 JetBrains DataGrip 的資料庫工具：

1. **連線管理和結構樹**：新增、編輯、測試連線；逐層瀏覽資料庫、schema、資料表、view、欄位、索引和鍵
2. **SQL Console**：用 Monaco 寫 SQL，執行游標所在的語句、選取範圍或整個檔案；結果用表格顯示，支援多個結果集、取消查詢、查看執行紀錄
3. **資料表畫面和直接編輯**：開啟資料表後可以篩選、排序、分頁；直接在格子裡修改、新增或刪除資料列，按 Submit 後用一個交易（transaction）寫入
4. **SSH Tunnel**：經由 Orca 已經存好的 SSH 主機，連到只能在內網存取的資料庫

## 2. 已確定的決策

| # | 決策 | 內容 |
|---|---|---|
| D1 | 形式 | **做成內建功能，不做成插件**。上游的插件 API（v0，實驗階段）有三個限制：面板只能呼叫 3 個 host 動作，叫不到自己的 worker；面板訊息上限 64KB、每 10 秒 30 則；面板只能放在側邊欄。要擴充這些得改上游插件核心，而且改完的插件也只能在 fork 上跑 |
| D2 | 位置 | **獨立的 Database 頁面**（新的 `TopLevelView: 'database'`，跟 Settings、Tasks、Space 同一層）。不做成編輯區分頁，也不放右側欄或底部面板。原因是要對上游的改動最少，而且頁面不綁 workspace，SSH／WSL／資料夾 workspace 都一樣能用 |
| D3 | 資料庫 | PostgreSQL、MySQL／MariaDB、SQL Server、SQLite |
| D4 | v1 範圍 | 連線管理和結構樹、SQL Console 和結果表格、資料表直接編輯、SSH Tunnel |
| D5 | 驅動 | 只用 MIT 授權的純 JS 驅動和 Node 內建的 `node:sqlite`，**不加原生模組**，避開 Linux glibc 下限的問題 |
| D6 | 執行位置 | 所有資料庫連線都在**本機**的 worker thread 裡執行。遠端資料庫一律經 SSH tunnel 連線，不走 relay。Tunnel 斷線時就回報斷線，**不會悄悄改成直接連線**（`docs/reference/ssh-execution-boundary.md`） |
| D7 | 密碼 | 用 `getSecretStore()` 加密後存檔，**加密不可用時不存明文**。密碼只存在 main，永遠不送到 renderer |
| D8 | 連線範圍 | 連線是**全域**的，不綁 repo 或 worktree（跟 DataGrip 的 global data source 一樣）。之後再考慮綁定專案 |
| D9 | 編輯範圍 | v1 **只有資料表畫面可以編輯**，而且資料表必須有主鍵或非 null 的唯一鍵。Console 查詢結果先唯讀 |
| D10 | 降低衝突 | 新程式碼放在新目錄：`src/main/database/`、`src/shared/database/`、`src/preload/api/database-*`、`src/renderer/src/components/database/`。對上游檔案只加最小的掛載點（§4） |
| D11 | 授權 | 只能參考其他工具的設計，**不能複製 GPL 專案的程式碼**（例如 Beekeeper Studio 是 GPLv3） |

## 3. 開源元件

| 元件 | 版本（2026-09-27） | 授權 | 用途 |
|---|---|---|---|
| `pg` + `pg-cursor` | 8.23 / 2.22 | MIT | PostgreSQL；用 cursor 分頁讀取 |
| `mysql2` | 3.24 | MIT | MySQL／MariaDB |
| `tedious` | 20.0 | MIT | SQL Server；需要 Node 22 以上，Electron 43 內建 Node 24.21，沒問題 |
| `node:sqlite` | 內建 | — | SQLite（`DatabaseSync`，同步 API，所以一定要放在 worker thread） |
| `ssh2` | 已有 | MIT | SSH tunnel（重用 Orca 現有的 SSH 連線） |
| `@tanstack/react-virtual` | 已有 | MIT | 表格虛擬捲動 |
| `monaco-editor` | 已有 | MIT | SQL 編輯器，已經有 `sql` 語言 |
| `sql-formatter` | 15.9 | MIT | 格式化 SQL（Phase 5，可選） |

打包注意事項：

- main 的 `dependencies` 預設是 external，`app.asar` 裡**沒有** `node_modules`。新驅動必須加進 `config/packaged-runtime-node-modules.cjs` 的 `PACKAGED_RUNTIME_PACKAGE_ROOTS`，或者加進 `electron.vite.config.ts` 的 `BUNDLED_MAIN_DEPENDENCIES` 打包進去。漏掉的話，`verifyPackagedMainRuntimeDeps` 會讓建置失敗
- `pnpm-workspace.yaml` 設了 `minimumReleaseAge: 4320`，新版本要發佈超過 3 天才能安裝
- `tedious` 會連帶裝 `@azure/identity`，體積較大。Phase 1 要量打包後的大小，再決定 bundle 還是 external

## 4. 現有程式碼的掛載點

### 4.1 上游檔案要加的掛鉤

**Main 和 preload**（跟 Run/Debug 一樣的做法，見 `src/main/debug/debug-ipc.ts`）：

| 檔案 | 改動 |
|---|---|
| `src/main/ipc/register-core-handlers/register-core-handlers.ts` 和它的 `.test.ts` | 呼叫 `registerDatabaseHandlers()`；測試加 `vi.mock` |
| `src/preload/api-types.ts`、`src/preload/index.ts` | 加上 `database` API |
| `electron.vite.config.ts` | worker entry 加進 `rollupOptions.input` |
| `config/build-plugins/plain-node-entry-guard.ts` | worker 名稱加進 `WORKER_THREAD_ENTRY_NAMES` |
| `config/packaged-runtime-node-modules.cjs` | 加上驅動套件 |
| `package.json` | 新依賴 |

**Database 頁面**（照上游 `space`、`automations` 頁面的做法，每處大多只改一行）：

| 檔案 | 改動 |
|---|---|
| `src/shared/ui-chrome-types.ts` | `TopLevelView` 加 `'database'` |
| `src/shared/top-level-view.ts` | lookup 加 `database: true` |
| `src/shared/rpc-contract/client-ui-params.ts` | `TopLevelViewSchema` 加 `'database'` |
| `src/renderer/src/store/slices/ui/ui-slice-contract-core.ts` | view history 型別和 `previousViewBeforeDatabase` |
| `src/renderer/src/store/slices/ui/ui-slice-view-actions.ts` | `openDatabasePage` / `closeDatabasePage` |
| `src/renderer/src/app-shell/AppWorkspaceShell.tsx` | `ActivePage` 加 `<DatabasePage />`（lazy load） |
| `src/renderer/src/lib/right-sidebar-visibility.ts`、`src/renderer/src/app-shell/use-app-chrome-layout.ts` | Database 頁面隱藏右側欄，版面比照 `space` |
| 入口：`StatusBarSurface.tsx`、`src/shared/keybindings/definitions-core-1.ts`、`app-command-handlers.ts` | 狀態列按鈕和快捷鍵（組合鍵在 Phase 0 查過衝突再決定） |
| `en.json`、`zh.json` | 新增 `database` namespace，再用 `config/scripts/fork-maintenance/generate-zh-tw-locale.mjs` 產生 `zh-TW.json`（不要手改） |

### 4.2 可以重用的東西

| 需求 | 重用 |
|---|---|
| Worker thread 範例 | `src/main/ai-vault/session-scanner-opencode-sqlite-worker-{entry,client,spawn,protocol}.ts`；路徑解析用 `src/main/worker-thread-entry-path.ts` |
| 載入 `node:sqlite` | `src/main/sqlite/sync-database.ts` 的 `process.getBuiltinModule('node:sqlite')` 寫法 |
| 加密儲存 | `src/shared/secret-store.ts`（`getSecretStore()`、`describeProtectionGap()`）；檔案格式照 `src/main/plugins/plugin-secrets-store.ts`（沒有明文 fallback） |
| 設定檔寫入 | `src/main/durable-file-write.ts`（`writeFileDurable`） |
| SSH 連線 | `getSshConnectionManager()`（`src/main/ssh/ssh-target-registry.ts`）的 `connect(target)` 會重用已連上的連線；帳密和 passphrase 的詢問流程已經有了 |
| SSH 轉發 | 每個 socket 呼叫 `client.forwardOut`，前例在 `src/main/browser/ssh-browser-network-execution-route.ts`。走系統 OpenSSH 的主機（ProxyJump、ProxyCommand、security key）拿不到 ssh2 client，改用 `src/main/ssh/system-ssh-forward-process.ts` 的 `ssh -L` |
| 表格 | `CsvViewer.tsx` 的列虛擬化和欄寬取樣；`git-log-table-columns.tsx` 的欄寬拖拉和雙擊自動調整 |
| 樹 | `DebugVariablesTree.tsx` 的展開時才載入；code outline 樹的鍵盤操作和 a11y role |
| Monaco（不是檔案的內容） | `AutomationEditorPromptEditor.tsx` |
| 連線設定對話框 | `EditRunConfigurationsDialog.tsx`（左邊清單、右邊表單）。注意：Dialog 裡放 DropdownMenu 會被 focus trap 卡住 |
| 可拖拉分隔 | `ResizeHandle.tsx`、`use-drag-resize.ts` |

## 5. 架構

```
Database 頁面 (renderer)
   │  window.api.database.*（invoke）/ onEvent（push）
   ▼
src/main/database/          連線設定、密碼、SSH tunnel、console 檔案、session 管理
   │  postMessage（request id；取消走獨立通道）
   ▼
worker thread（每個開啟的 session 一個）  驅動、cursor、取消、交易
```

### 5.1 Main（`src/main/database/`）

- `database-ipc.ts`：`database:*` handler。參數一律先當 `unknown`，再用 zod 驗證；錯誤回傳 `{ ok: false, message }`；用 `sender.send('database:event', …)` 推送 session 狀態
- `connection-config-store.ts`：`userData/database/connections.json`，不含密碼
- `connection-secrets.ts`：加密的密碼檔。儲存方式跟 DataGrip 一樣有三種：永久、只到關閉 Orca 為止、不儲存（每次詢問）。Linux 沒有 keyring 時，UI 要清楚說明無法儲存
- `ssh-tunnel.ts`：在 `127.0.0.1` 開一個隨機埠，每個連入的 socket 各自 `forwardOut`；tunnel 跟著 session 一起開關
- `session-worker-host.ts`：每個 session 一個 `Worker`，設定 `resourceLimits` 限制記憶體；worker 當掉時 session 變成錯誤狀態，不會影響 main
- `console-files.ts`：console 內容存在 `userData/database/consoles/<connectionId>/*.sql`，永遠在本機

### 5.2 Worker（`src/main/database/worker/`）

- 共用的驅動介面：`connect`、`close`、`introspect(層級, 路徑)`、`execute(sql)`（回傳第一頁和 cursor）、`fetchMore(cursorId, n)`、`cancel()`、`applyChanges(batch)`
- 各驅動：

| 驅動 | 分頁 | 取消 | 其他 |
|---|---|---|---|
| PostgreSQL | `pg-cursor` | 另開連線執行 `pg_cancel_backend(pid)` | 報錯時有 `position`，可以在編輯器標出錯的位置；SSL mode |
| MySQL／MariaDB | query stream | 另開連線執行 `KILL QUERY <id>` | `dateStrings`、`bigNumberStrings`，避免精度遺失 |
| SQL Server | `row` 事件 | `connection.cancel()` | 多結果集；`encrypt`、`trustServerCertificate` |
| SQLite | `StatementSync.iterate()` | 無法中斷，只能結束 worker 再重開（未提交的交易會遺失，UI 要先警告） | 可用唯讀模式開檔；檔案必須在本機 |

- 傳輸格式：值盡量保留資料庫原本的文字表示（數值、時間），避免精度遺失，編輯時也能精確比對。型別：`null`、字串、安全範圍內的數字、布林、`{ t: 'big', v }`、`{ t: 'bin', size, hex }`（只帶前段）
- 語句切分依方言處理：引號、註解、PostgreSQL 的 `$$`、SQL Server 的 `GO`、MySQL 的 `DELIMITER`

### 5.3 Renderer（`src/renderer/src/components/database/`）

- 版面：左邊是可拖拉寬度的連線樹，中間是自己的分頁列
  - Console 分頁：上面 Monaco，下面結果區（每個結果集一個分頁，外加 Output 紀錄：耗時、影響列數、錯誤）
  - 資料表分頁：上面是篩選列（`WHERE`、`ORDER BY` 輸入框），中間是表格，下面是待送出變更的工具列
- 狀態：fork 自己的 zustand store，開啟的分頁和樹的展開狀態存在 localStorage（`orca.database.page.v1`）；連線資料一律向 main 讀取
- `DataGrid` 元件：列虛擬化（欄位很多時連欄一起虛擬化）、固定表頭、拖拉欄寬、儲存格和範圍選取、鍵盤移動、複製成 TSV／CSV／JSON／INSERT、NULL 用不同樣式、長文字和 JSON 用側邊檢視器
- Monaco：`Cmd/Ctrl+Enter` 執行游標所在的語句或選取範圍；執行錯誤標在編輯器上；Phase 5 加上依結構自動補全

### 5.4 資料表編輯

- 條件：資料表有主鍵，或有非 null 的唯一鍵。不符合的話表格唯讀，並顯示原因
- 修改過的格子、新增和刪除的列都會標示出來；可以還原單格、單列或全部；可以預覽將要執行的 SQL
- Submit：worker 在**一個交易**裡用參數化語句執行。每個 UPDATE／DELETE **必須剛好影響 1 列**，否則整批 rollback 並指出是哪一列（防止別人同時改了資料，或鍵值對不上）
- 產生的 SQL：識別字依方言加引號，值一律用參數，**絕不字串拼接**

### 5.5 安全設計

- 唯讀連線選項：PostgreSQL 設 `default_transaction_read_only`；MySQL 用 `SET SESSION TRANSACTION READ ONLY`；SQLite 用唯讀模式開檔；SQL Server 沒有 session 層級的唯讀，只能在 app 裡依語句類型擋下，這是盡力而為，UI 要照實說明
- 執行沒有 `WHERE` 的 UPDATE／DELETE 前先警告（DataGrip 也這樣做）

## 6. 分階段計畫

每個 Phase 做完都要能用、能測，合回 `omar/custom` 並用 fork 建置腳本產出安裝檔。

### Phase 0：基礎架構 + PostgreSQL 打通

- 依賴和打包設定（`pg`、`pg-cursor`），並確認打包後的 app 載得到
- worker host、IPC、連線設定檔、密碼加密
- Database 頁面：`TopLevelView`、狀態列入口、快捷鍵
- 連線對話框，含 Test Connection
- 結構樹：連線 → schema → 資料表（展開時才載入）
- Console：Monaco、執行、唯讀結果表格（虛擬捲動、載入更多、取消）
- 驗收：連到本機 PostgreSQL 17（Homebrew），瀏覽結構；10 萬列結果捲動順暢；`SELECT pg_sleep(30)` 可以取消

### Phase 1：其他三種資料庫

- MySQL／MariaDB、SQL Server、SQLite 的驅動、結構查詢、語句切分、取消
- 量 `tedious` 的打包大小，決定 bundle 還是 external
- 用 Docker 跑整合測試（見 §7）

### Phase 2：表格完整化和資料表分頁

- 資料表分頁：分頁載入、`WHERE`／`ORDER BY` 篩選、點表頭排序（資料表由資料庫排序，console 結果在本機排序）
- 範圍選取、複製和匯出格式、值檢視器、欄寬調整

### Phase 3：資料表編輯

- 待送出變更、還原、預覽 SQL、在交易中送出
- 各方言的 INSERT／UPDATE／DELETE 產生和參數化

### Phase 4：SSH Tunnel

- 連線設定可以選一個已存的 SSH 主機
- ssh2 走 `forwardOut`，系統 OpenSSH 走 `ssh -L`
- Tunnel 狀態和錯誤訊息顯示在連線樹上

### Phase 5：打磨

- SQL 自動補全（關鍵字、資料表、欄位）、格式化、查詢歷史
- 唯讀和「正式環境」標示（連線顏色）
- 結構樹補上 view、routine、索引、鍵、DDL 檢視
- 手動交易模式（Commit／Rollback 按鈕）
- 快捷鍵、繁體中文字串

## 7. 測試策略

- **單元測試**：值的編碼、各方言的語句切分、DML 產生和識別字引號、設定檔和密碼檔、tunnel 生命週期（mock ssh2）
- **整合測試**：對真的資料庫跑，沒有資料庫時跳過（用環境變數開啟）
  - PostgreSQL：本機 Homebrew `postgresql@17`
  - Docker：`mysql:8`、`mariadb:11`、`mcr.microsoft.com/mssql/server:2022`（只有 x64 映像檔，在 Apple Silicon 上要靠 Rosetta，Phase 1 先確認跑得起來）
  - SQLite：暫存檔
- **UI 驗證**：Playwright CDP，一律用 `ORCA_BACKGROUND_LAUNCH=1` 在背景啟動，截圖隱藏視窗，不搶焦點（AGENTS.md）

## 8. 必須遵守的專案規則（摘自 AGENTS.md）

- UI 照 `docs/STYLEGUIDE.md`，用 `main.css` 的 token 和 `components/ui/` 的元件；跑 `pnpm run check:code-quality:changed`
- 絕不停用 `max-lines`；檔案行數上限是 300／400，而且只會越來越嚴，檔案要拆小
- 檔名要說清楚內容，不用 `helpers`、`utils` 之類的名字
- 型別斷言要附 `SAFETY:` 說明
- 子程序（例如系統 `ssh`）一律透過 `src/shared/child-process/` 的 `runProcess`／`spawnProcess`
- 跨平台：快捷鍵用 `CmdOrCtrl`，Mac 顯示 `⌘`，其他平台顯示 `Ctrl+`；路徑用 `path.join`
- 驗證：`pnpm tc`、`pnpm test <path>`、`oxlint`

## 9. 風險

| 風險 | 對策 |
|---|---|
| `tedious` 連帶的 `@azure/identity` 讓打包變大或打包失敗 | Phase 1 先量；必要時改成 external 並加進 runtime package 清單 |
| 查詢結果太大，吃光記憶體 | 分頁載入（預設每頁 500 列），renderer 暫存的列數有上限（預設 10 萬，可調整）；worker 用 `resourceLimits` 限制記憶體 |
| 開很多 session，worker 太多 | 每個 session 一個 worker 是為了隔離和取消。閒置的 session 自動斷線 |
| SQLite 無法中斷查詢 | 只能結束 worker；如果有未提交的交易，先警告 |
| 上游新增其他頁面時，`TopLevelView` 那幾行會衝突 | 都是一行的 union 改動，容易解；rerere 會記住解法 |
| Linux 沒有 keyring 時無法儲存密碼 | 照實告知，改成每次連線時詢問 |
| SQL Server 映像檔在 Apple Silicon 上跑不起來 | 改用 Rosetta 設定或在 CI 上測 |

## 10. 不在這一輪的範圍（之後再做）

- 編輯 console 的查詢結果（非資料表畫面）
- ER 圖、schema 比對、migration
- CSV 匯入精靈
- SQL Server 的 Windows 驗證和 Azure AD 登入
- 經由 SSH 開遠端主機上的 SQLite 檔案
- 其他資料庫（Oracle、MongoDB、Redis、ClickHouse 等）
- 執行計畫（EXPLAIN）視覺化
- 連線綁定 repo 或 worktree
- 改成插件（要等上游插件 API 支援面板和 worker 之間通訊、更大的訊息量）

## 11. 參考資料

- DataGrip 文件（只參考介面概念）：https://www.jetbrains.com/help/datagrip/
- node-postgres：https://node-postgres.com/
- mysql2：https://sidorares.github.io/node-mysql2/docs
- tedious：https://tediousjs.github.io/tedious/
- `node:sqlite`：https://nodejs.org/api/sqlite.html
- Orca：`docs/reference/ssh-execution-boundary.md`、`docs/reference/pnpm-install-policy.md`、`docs/fork/run-debug-configurations-plan.md`
