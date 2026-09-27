# Database 工具（DataGrip 風格）：實作計畫（fork 專屬）

> 狀態：Phase 0（基礎架構 + PostgreSQL）、Phase 1（MySQL／MariaDB、SQL Server、SQLite）、Phase 2（資料表分頁、表格完整化）、Phase 3（資料表編輯）和 Phase 4（SSH Tunnel）已完成（2026-09-27），紀錄見 §6.1～§6.6。Phase 5 尚未開工
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
| 入口：`StatusBarSurface.tsx`、`src/shared/keybindings/types.ts`、`definitions-core-4.ts`、`app-command-handlers.ts` | 狀態列按鈕和快捷鍵 `Mod+Alt+D`（`definitions-core-1.ts` 已滿 300 行，所以放在 core-4） |
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
- 狀態：fork 自己的 zustand store，開啟的分頁存在 localStorage（`orca.database.page.v1`）；連線資料一律向 main 讀取。樹的展開狀態目前沒有保存：還原它就得在啟動時連上資料庫（可能跳出密碼詢問），待定
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

### 6.1 Phase 0 完成紀錄（2026-09-27）

驗收都通過了：連到 PostgreSQL 17、瀏覽結構、1,200 列分頁載入、`pg_sleep(30)` 可取消、錯誤位置標在編輯器上。

和原計畫不同、或實作時才決定的地方：

- **Session 切分**：每個連線一個 worker；worker 裡有一個專查結構和取消查詢的 session，另外每個 console 各自一個 server session（跟 DataGrip 預設一樣）。原因是 pg 的 client 一次只跑一個查詢，而沒讀完的 cursor 會一直佔著它
- **密碼流程**：沒有密碼時先嘗試不帶密碼連線（trust 驗證或 `~/.pgpass`），伺服器拒絕時才跳出密碼提示。提示輸入的密碼依連線的儲存設定處理
- **上一頁**：Database 頁面記住的「上一個頁面」放在 fork 自己的模組裡，不加進上游的 UI slice
- **打包**：`pg`、`pg-cursor` 不打包進 bundle，而是加進 `PACKAGED_RUNTIME_PACKAGE_ROOTS`（`pg` 有可選的 `pg-native` 引用）。`pg-cloudflare` 只有 Cloudflare Workers 會載入，沒複製是對的。已用平鋪的 `node_modules` 模擬打包後的目錄，實際跑過建置出來的 worker
- **繁體中文**：`zh-tw-term-overrides.json` 加了幾條用語規則（只讀→唯讀、控制台→主控台、新建→新增、斷開連線→中斷連線、資料列數的「行」→「列」），會一併修正約 70 個上游字串

已知限制（留到後面的 Phase）：

- Console 結果唯讀；結構樹只有 schema、資料表、view、欄位
- 語句切分只支援 PostgreSQL 語法；還沒有自動補全，也沒有標示正在執行的語句
- 重新執行時會清掉上一次的結果分頁

測試方式：

- 單元測試：`pnpm exec vitest run --config config/vitest.config.ts src/main/database src/shared/database src/renderer/src/components/database`
- 整合測試和 e2e 需要一個可以丟棄的 PostgreSQL，用 `ORCA_TEST_POSTGRES_URL` 開啟，例如在 scratch 目錄 `initdb -U orca_test --auth=trust`，再用 `pg_ctl -o "-p 55439 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" start` 啟動：
  - `ORCA_TEST_POSTGRES_URL=postgres://orca_test@127.0.0.1:55439/postgres pnpm exec vitest run --config config/vitest.config.ts src/main/database/worker/postgres-session.integration.test.ts`
  - `ORCA_TEST_POSTGRES_URL=… pnpm run test:e2e tests/e2e/database-page.spec.ts`（spec 會先把介面切成英文，不受系統語系影響）

做 Phase 0 時發現、但不屬於這個功能的既有問題：

- `pnpm run verify:localization-runtime-catalog` 失敗：Run、Quick Commands、語言設定有 4 個字串沒進 `en-runtime-required.json`
- `pnpm run check:code-quality:changed` 有 5 個既有問題，在 `components/run/ProjectRunContextMenuItems.tsx` 和 IME 的測試檔

### Phase 1：其他三種資料庫

- MySQL／MariaDB、SQL Server、SQLite 的驅動、結構查詢、語句切分、取消
- 量 `tedious` 的打包大小，決定 bundle 還是 external
- 用 Docker 跑整合測試（見 §7）

### 6.2 Phase 1 完成紀錄（2026-09-27）

同一套一致性測試（`database-driver-conformance.integration.test.ts`）對 PostgreSQL 17、MySQL 8.4、MariaDB 11、SQL Server 2022、SQLite 都跑過：指令結果、1,200 列分頁、錯誤、結構查詢、取消、console 互不干擾、唯讀。兩個 e2e（PostgreSQL、SQLite）也都通過。

實作時的決定：

- **分頁**：MySQL 和 SQL Server 的驅動是一列一列推送資料，`PagedBatchReader` 在滿一頁時暫停資料流。同一批次裡的後續結果集，會跟著分頁結果最後一頁的 `followingResults` 一起送來，畫面上開成新的結果分頁
- **執行結果**：`execute` 改成回傳多個結果集（`{ results: [...] }`），因為 SQL Server 的批次和 MySQL 的 procedure 都可能回傳好幾個
- **SQL Server 的語句切分**：游標所在的語句依 `;` 和 `GO` 切；選取範圍和「全部執行」則以 `GO` 批次為單位送出，這樣 `DECLARE` 的變數才能在批次裡使用（跟 SSMS 的習慣一樣）
- **SQL Server 的列數**：`DECLARE`／`SET` 在協定上也會回報「1 列」，跟 DML 分不出來。所以批次有結果集時只顯示結果集；全部都是指令時，才把影響列數加總成一筆
- **唯讀**：PostgreSQL、MySQL 由伺服器擋（session 設成唯讀）；SQLite 用唯讀模式開檔；SQL Server 沒有 session 唯讀，改由 Orca 擋下含寫入關鍵字的語句（盡力而為，表單上有說明）
- **SQLite 跑在獨立程序**：SQLite 的查詢在原生程式碼裡執行，worker thread 在查詢中途結束不了。所以 SQLite 的連線用 `forkProcess` 開子程序，取消時直接結束它，下次執行自動重連。其他資料庫仍用 worker thread，取消走協定本身（`pg_cancel_backend`、`KILL QUERY`、TDS attention）。打包時 `database-worker-entry.js` 要解壓到 asar 外（已加進 `asarUnpack`）
- **打包**：`tedious` 一載入就會引用整串 Azure SDK，所以打包進 worker（worker 檔案約 1.3MB），不把約 45MB 的 `node_modules` 複製進去。`mysql2` 維持 external，加進 runtime 套件清單。已用平鋪的 `node_modules` 模擬打包後的目錄，四種資料庫都實際跑過
- **SQLite 選檔**：新增 `database:pickSqliteFile` IPC（Electron 開檔對話框）。只能開既有的檔案，打錯路徑不會悄悄建立空資料庫
- **連線對話框**：最上面選資料庫種類，切換時只替換還是預設值的 port、資料庫、使用者，不會蓋掉使用者已經填的內容

已知限制：

- SQL Server：只支援 SQL 帳號登入（沒有 Windows／Azure AD）；`tedious` 把 DECIMAL 轉成 JS 數字，超過約 15 位有效數字會失去精度；`datetime2(7)` 只顯示到毫秒；混合批次（DML 加 SELECT）不顯示 DML 的影響列數
- MySQL：FLOAT／DOUBLE 以 JS 數字的格式顯示
- SQLite：不能建立新檔案；SSH workspace 裡遠端主機上的 SQLite 檔案還不支援

整合測試方式（伺服器用 Docker 跑，SQLite 不需要設定，每次都會跑）：

```
docker run -d --rm --name orca-db-it-mysql -p 127.0.0.1:53306:3306 -e MYSQL_ROOT_PASSWORD=orca-test-pw -e MYSQL_DATABASE=orca_it mysql:8.4
docker run -d --rm --name orca-db-it-mariadb -p 127.0.0.1:53307:3306 -e MARIADB_ROOT_PASSWORD=orca-test-pw -e MARIADB_DATABASE=orca_it mariadb:11
docker run -d --rm --name orca-db-it-mssql -p 127.0.0.1:51433:1433 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=Orca-test-Pw1 mcr.microsoft.com/mssql/server:2022-latest

ORCA_TEST_POSTGRES_URL=postgres://orca_test@127.0.0.1:55439/postgres \
ORCA_TEST_MYSQL_URL=mysql://root:orca-test-pw@127.0.0.1:53306/orca_it \
ORCA_TEST_MARIADB_URL=mysql://root:orca-test-pw@127.0.0.1:53307/orca_it \
ORCA_TEST_SQLSERVER_URL=sqlserver://sa:Orca-test-Pw1@127.0.0.1:51433/master \
pnpm exec vitest run --config config/vitest.config.ts src/main/database
```

SQL Server 的映像檔只有 amd64，在 Apple Silicon 上透過 Rosetta 可以正常跑。

繁體中文：`zh-tw-term-overrides.json` 補了「隻讀→唯讀」（OpenCC 有時會轉錯），資料列數的規則也涵蓋直接寫數字的情況（「1 列」）

### Phase 2：表格完整化和資料表分頁

- 資料表分頁：分頁載入、`WHERE`／`ORDER BY` 篩選、點表頭排序（資料表由資料庫排序，console 結果在本機排序）
- 範圍選取、複製和匯出格式、值檢視器、欄寬調整

### 6.3 Phase 2 完成紀錄（2026-09-27）

兩個 SQLite e2e（console；資料表分頁的篩選、表頭排序、計算總列數、值檢視器）和 PostgreSQL e2e 都通過；新增的純邏輯（選取、排序、匯出格式、資料表 SQL、值格式化、欄寬捲動、匯出檔名）都有單元測試。

實作時的決定：

- **分頁種類**：分頁改成 `console | table` 兩種（`database-page-tabs.ts`），localStorage 裡沒有 `kind` 的舊分頁視為 console。資料表分頁佔兩個伺服器 session：一個讀資料，一個跑 `count(*)`，計數再慢也不會卡住捲動載入；關分頁時兩個都釋放
- **開啟資料表**：結構樹上雙擊或按 Enter 開資料表（其他節點照舊展開），右鍵選單多了「Open Data」。同一張表只開一個分頁
- **資料表查詢**：`select * from <表> where … order by …`，每段各佔一行，所以使用者在 WHERE 最後寫 `-- 註解` 不會把 ORDER BY 註解掉。WHERE／ORDER BY 是原樣送出的 SQL 片段（跟 DataGrip 一樣），唯讀連線照樣由伺服器擋寫入
- **排序**：資料表點表頭會改寫 ORDER BY 再查一次（升冪 → 降冪 → 取消）；console 結果只排已載入的列（NULL 升冪排最後，跟 PostgreSQL 一樣），選取和複製依畫面上的順序
- **重新查詢不閃爍**：資料表重新查詢時先保留上一份結果；欄寬以欄位名稱加型別當 key，所以篩選、排序後手動調過的欄寬都還在
- **選取和複製**：拖曳、Shift＋點擊、點列號選整列、Shift＋方向鍵、`Mod+A`；`Mod+C` 複製成 TSV（貼到試算表會落在同樣的格子）。右鍵選單另有連同表頭複製、複製為 CSV／JSON／SQL INSERT。console 結果不知道來源表，INSERT 用 `my_table` 當表名
- **匯出**：「匯出已載入的列」用新的 `database:saveExport` IPC（存檔對話框加寫檔，內容上限 256M 字元，檔名依各平台規則清理），完成後跳 toast
- **值檢視器**：`Shift+Enter`、右鍵「Show Value」或結果下方的按鈕開關，寬度可拖拉，開關和寬度都記在 localStorage。JSON 物件／陣列會排版；被截斷的值只顯示預覽和原本長度（預覽截在中間，不嘗試排版）
- **快捷鍵顯示**：右鍵選單和提示用共用的 `formatKeybinding`，Mac 顯示符號，其他平台顯示 `Ctrl`／`Shift`

已知限制：

- 被截斷的超長值，值檢視器和複製都只拿得到預覽（要看完整值得等之後補「讀取完整值」）
- 匯出和複製只含已載入的列（最多 100,000 列），不會重新查詢整張表
- 計算總列數無法取消；在超大表上可能跑很久（不影響資料捲動）
- 表頭排序的箭頭只反映點表頭產生的排序；手動輸入的 ORDER BY 不會顯示箭頭

繁體中文：`zh-tw-term-overrides.json` 新增只比對整句的規則，把這幾句的「行」改成「列」、欄寬改成「欄寬」、「單元格」改成「儲存格」，不會影響 notebook 等其他地方的用詞。WHERE、ORDER BY 是 SQL 關鍵字，不翻譯，加進 `localization-coverage-allowlist.json`。

### 6.4 Phase 0–2 補驗證紀錄（2026-09-27）

Phase 0、1 原本只有整合測試和兩個 e2e。這一輪用真實 app 把使用者會碰到的流程都跑過，看截圖，並對每個修正確認「拿掉修正測試就會失敗」。資料庫相關 e2e 共 15 個，全部通過：

| spec | 內容 |
|---|---|
| `database-page.spec.ts` | PostgreSQL：連線、分頁、錯誤標記；保留字和大小寫混合名稱的資料表分頁 |
| `database-page-sqlite.spec.ts` | SQLite：console、取消；資料表分頁的篩選、排序、計數、值檢視器 |
| `database-grid-transfers.spec.ts` | 各種複製格式和匯出檔案（攔截剪貼簿和存檔對話框，不動到真的剪貼簿） |
| `database-grid-columns.spec.ts` | 拖拉欄寬、最小寬度、鍵盤調整、雙擊自動調整、重新查詢後保留欄寬 |
| `database-passwords.spec.ts` | 三種密碼儲存方式、密碼錯誤的提示、重開 app、伺服器改密碼後重新詢問、磁碟上沒有明文 |
| `database-connections.spec.ts` | 新增（測試失敗、選檔）、改名、中斷／連線、刪除（連帶關掉分頁）、`Mod+Alt+D`、唯讀、Refresh、游標／選取／全部執行 |
| `database-restart.spec.ts` | 重開 app 後還原頁面、console 文字、資料表分頁和篩選 |
| `database-server-drivers.spec.ts` | MySQL、MariaDB、SQL Server：連線、兩個結果集（含 `DELIMITER` 建 procedure）、取消、資料表分頁、唯讀 |
| `database-page-zh-tw.spec.ts` | 繁體中文介面走一遍主要流程 |

伺服器相關 spec 用跟整合測試一樣的環境變數。密碼測試另外需要伺服器對 `orca_pw_*` 帳號要求密碼，在 `pg_hba.conf` 第一行加上：

```
host  all  /^orca_pw_  127.0.0.1/32  scram-sha-256
```

找到並修正的問題：

- `Mod+Alt+D` 從來沒作用：全域快捷鍵只派送 plugin alias 清單裡的動作。改成跟 `workspace.delete` 一樣單獨派送（Git Log 面板的 `bottomPanel.gitLog.toggle` 有同樣問題，屬於另一個分支，沒動）
- 連線中編輯設定（唯讀、主機、帳號…）不會生效，舊的 session 繼續用。現在設定有變就中斷，下一個動作用新設定重連；只改名稱或密碼儲存方式不中斷
- SQLite 對 `CREATE`、`BEGIN` 等語句回報上一個 DML 的列數；MySQL 對 DDL 回報 0 列；SQL Server 的 DDL 沒有標示語句名稱。現在五種資料庫一致：只有會改資料的語句顯示影響列數
- 識別字是保留字（`user`、`order`）時沒加引號，SQL 會出錯。現在各方言有自己的保留字清單
- 欄寬用「每字 7px」估算，等寬字型實際較寬，值一開始就被截斷。改用 canvas 以實際字型量測
- 在欄邊按方向鍵會連帶移動格子選取
- 數字和時間用系統語系格式化，不跟 Orca 的介面語言
- 無障礙：連線狀態只用顏色表示、密碼詢問框的輸入欄沒有標籤、結構樹每一列的名稱前面都多了「Expand or collapse」
- 選取的格子幾乎看不出來（淺灰底），改用樣式規範指定的 `bg-foreground/10`；雙擊結構樹會把文字反白

還沒驗證到的：SSH workspace（Phase 4 才做）、實際打包出的安裝檔（只用模擬目錄驗過）。

### Phase 3：資料表編輯

- 待送出變更、還原、預覽 SQL、在交易中送出
- 各方言的 INSERT／UPDATE／DELETE 產生和參數化

### 6.5 Phase 3 完成紀錄（2026-09-27）

資料庫相關 e2e 共 17 個全部通過，其中編輯相關：SQLite 兩個（編輯、設 NULL、刪除、新增、預覽、送出、改回；別人先刪掉某列時整批 rollback；重新查詢和關分頁前詢問；沒有主鍵的表唯讀），PostgreSQL（保留字和大小寫混合名稱）、MySQL、MariaDB、SQL Server 各在畫面上改一格並送出。`database-table-changes.integration.test.ts` 對五種資料庫跑同一組變更（刪、改、新增一起送出、別人刪掉的列、主鍵重複），都驗證整批 rollback 並指出是哪一筆。

實作時的決定：

- **SQL 產生**：`src/shared/database/table-change-sql.ts` 依方言產生 DELETE、UPDATE、INSERT，每個值都是參數（`$n`、`?`、`@pn`），識別字依方言加引號。同一個函式也產生預覽用的 SQL（值寫成字面值），所以預覽和實際執行的語句一致。順序固定為刪除 → 修改 → 新增，避免「刪掉主鍵 5 再新增主鍵 5」衝突
- **交易**：每個驅動提供「執行一句並回傳影響列數、commit、rollback」，共用的 `applyTableChanges` 逐句執行；UPDATE、DELETE 不是剛好 1 列，或任何一句出錯，就整批 rollback，錯誤帶 `changeIndex` 回到畫面，標出是哪一列（新增的選填欄位，舊版不受影響）
- **各驅動的參數**：pg 用參數化 query；mysql2 用 `execute`（伺服器端 prepared statement；預設的 FOUND_ROWS 讓值沒變的 UPDATE 也算 1 列）；tedious 用 `sp_executesql` 加 NVarChar 參數，由伺服器轉成欄位型別；SQLite 用 prepared statement。值一律以文字送出，由伺服器轉型
- **在哪個 session 送出**：資料表分頁自己的資料 session。送出前會關掉還開著的 cursor；成功後重新查詢
- **唯讀**：唯讀連線在 main 就擋下（SQL Server 沒有 session 唯讀），畫面上工具列顯示「Read-only」並說明原因；沒有主鍵的表也一樣
- **畫面**：雙擊、Enter、F2 或右鍵「Edit Value」就地編輯（多行值用可長高的輸入框，Shift／Alt+Enter 換行）；NULL 格清空後送出仍是 NULL；新增的列沒填的欄位顯示 DEFAULT，送出時省略、由資料表預設值決定。修改的格子、新增的列、要刪除的列各有標示（沿用 status／destructive token）
- **不丟掉修改**：修改存在每個分頁自己的 store，切換分頁不會消失；重新查詢（重新整理、篩選、點表頭排序）和關分頁前都會詢問
- **不能編輯的格子**：二進位欄位、只載入預覽的超長值、標記刪除的列，點了會說明原因

已知限制：

- 只支援有主鍵的表；計畫裡「非 null 唯一鍵」還沒做
- 送出失敗後，資料 session 的 cursor 已關閉，還沒載入的列要重新整理才能繼續往下捲
- SQL Server：tedious 回報的列數可能把 trigger 改到的列也算進去，有會改其他列的 trigger 的表可能被誤判而拒絕送出（未驗證）
- 值以文字送出，日期等格式要是伺服器接受的寫法
- 修改只存在記憶體，關掉 Orca 就沒了（關分頁和重新查詢會先問）
- 右鍵「Edit Value」延後到選單關閉才開輸入框，避免選單把焦點還給表格時輸入框失焦。e2e 在隱藏視窗執行，焦點事件跟實際桌面不同，這一點只能靠推理，沒辦法在這裡驗證
- 不能編輯 console 的查詢結果（見 §10）

繁體中文：新增的規則只比對這些資料庫字串整句，把 行 改成 列、二進位制 改成 二進位、事務 改成 交易、引數 改成 參數；Markdown 表格編輯器用「行」表示 row，那些字串不受影響。

### Phase 4：SSH Tunnel

- 連線設定可以選一個已存的 SSH 主機
- ssh2 走 `forwardOut`，系統 OpenSSH 走 `ssh -L`
- Tunnel 狀態和錯誤訊息顯示在連線樹上

### 6.6 Phase 4 完成紀錄（2026-09-27）

用 Docker 開一台 SSH 伺服器當跳板，e2e 透過它連到只有 Docker 內網才連得到的 MySQL（查 `@@hostname` 回傳容器自己的名字，證明真的走隧道），以及本機的 PostgreSQL（容器透過 `host.docker.internal` 連到）。ssh2 和系統 OpenSSH 兩種 SSH 連線方式都驗證過。另外也驗證了：SSH 連線被重置時資料庫連線標示為中斷、重新連線會重建隧道、SSH 主機連不到資料庫時顯示 SSH 主機自己的原因、系統 OpenSSH 的轉發程序中止時也會標示。

實作時的決定：

- **重用 Orca 的 SSH**：連線用 `connectRegisteredSshTarget`（已連線就沿用、正在連線就一起等，密碼和金鑰密碼走 Orca 既有的 SSH 詢問視窗），轉發用既有的 ssh2／系統 OpenSSH provider
- **獨立的轉發管理器**：共用的 Ports 面板轉發會被存進 SSH 主機設定、列在 Ports 面板、而且每次 relay 重連都被清掉。資料庫隧道用自己的 `SshPortForwardManager`，只跟著資料庫 session 開關
- **連不到時說清楚**：ssh2 的轉發在對方拒絕時只會默默關掉 socket，驅動只會看到「連線被關閉」。所以開隧道前先用同一條 SSH 連線試開一次通道，失敗就顯示 SSH 主機的原因
- **斷線偵測**：SSH 連線被重置或中斷時（`registerSshProviderRequestAbort`），隧道關閉並把資料庫連線標示為中斷；訊息寫「隧道已無法使用」，不說遠端程序結束（依 `ssh-execution-boundary.md`）。系統 OpenSSH 的 `ssh -L` 程序結束時也一樣。之後重新連線會重建 SSH 和隧道
- **TLS 仍驗證真正的主機**：驅動連到 127.0.0.1 的本機埠，但憑證要對原本的資料庫主機名稱驗證。pg 用 `ssl.servername`、tedious 用 `serverName`；mysql2 只會拿 `host` 當 TLS 名稱，所以 host 保留真正的名稱，socket 改由 `stream` 連到本機埠
- **畫面**：連線表單多一個「SSH tunnel」選單（已儲存的 SSH 主機；主機被刪掉時仍顯示「Removed SSH host」，不會悄悄改成直連）；結構樹的連線後面顯示「via 主機名稱」

這一輪順便修正的問題：

- **MySQL 的 `verify-full` 沒有驗證主機名稱**（Phase 1 起）：mysql2 要另外設 `verifyIdentity` 才會比對主機名稱，原本只驗證憑證鏈
- **連線中斷訊息重複**：mysql2 自己的訊息已經以「Connection lost:」開頭，畫面上變成「Connection lost: Connection lost: …」

測試方式：`ORCA_E2E_SSH_DOCKER=1` 加上 §6.2 的資料庫環境變數，執行 `tests/e2e/database-ssh-tunnel.spec.ts`。第一次會建 relay bundle 和 SSH 測試用的 Docker 映像檔。

已知限制：

- 走 Orca 標準的 SSH 連線，所以跟 SSH workspace 一樣會在 SSH 主機上部署 Orca 的 relay；不允許執行 relay 的跳板機目前不能用
- 系統 OpenSSH 模式（ProxyJump、ProxyCommand、硬體金鑰等會用到）不能詢問密碼，要用金鑰或 ssh-agent，這是 Orca 既有的限制
- 經由隧道的 `verify-full` 已經設定成比對真正的主機名稱，但沒有用真實憑證驗證過
- SSH 重連後隧道不會自動重建，資料庫連線顯示中斷，要手動再連

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
