# Database 工具（DataGrip 風格）：實作計畫（fork 專屬）

> 狀態：Phase 0（基礎架構 + PostgreSQL）、Phase 1（MySQL／MariaDB、SQL Server、SQLite）、Phase 2（資料表分頁、表格完整化）、Phase 3（資料表編輯）和 Phase 4（SSH Tunnel）已完成（2026-09-27），紀錄見 §6.1～§6.6。Phase 5 尚未開工
> 分支：從 `omar/custom` 開 `feat/database`，每個 Phase 完成後合回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。
>
> **2026-09-28 方向調整：整個 Database 工具只做唯讀。** 資料表編輯（Phase 3）、console 交易控制、執行 SQL 腳本（Phase 6.1）都已移除，見 §0。下面各 Phase 的完成紀錄保留原樣，當作歷史。

## 0. 方向調整：全部唯讀（2026-09-28）

使用者決定所有功能都只能做唯讀操作。決定的內容：

- **伺服器端強制，加上送出前檢查**（兩層都要）
- **保留 dump 和匯出**（Phase 6.2／6.3）：它們只從資料庫讀，寫的是本機檔案；但不再有在 Orca 裡匯回去的功能
- **不要再加回寫入功能**，除非使用者明確要求

已移除：

- 資料表編輯：改格子、新增／刪除列、預覽和送出、離開前的「捨棄修改」詢問；`applyChanges` IPC 和 worker 指令、變更 SQL 產生器、驅動的 `beginChanges`
- Console 的交易控制：Auto-commit／Manual 模式、Commit／Roll Back、關閉有交易的 console 時的詢問；worker 的 `ConsoleTransactions`
- 執行 SQL 腳本（Phase 6.1）：以 revert 移除（`e188283865`）
- 每條連線的「Read-only」開關和鎖頭圖示：現在一律唯讀，頁首標題旁顯示「Read-only」，滑過去有說明
- DROP／ALTER DATABASE 前釋放 Orca 閒置連線的處理（寫入語句已經送不出去）
- 補全不再提供寫入用的關鍵字（INSERT INTO、UPDATE、CREATE、COMMIT、RETURNING…）

唯讀怎麼保證：

- **送出前**：worker 收到的每一條 console／資料表語句都先過 `readOnlyViolation`（`src/shared/database/sql-read-only-guard.ts`），跳過字串、註解和加引號的名稱，只看關鍵字
  - 開頭是寫入指令的語句：INSERT、UPDATE、DELETE、MERGE、REPLACE、CREATE、ALTER、DROP、TRUNCATE、GRANT、VACUUM、ATTACH、LOAD、BACKUP、DO…
  - 任何位置出現就擋的詞：INSERT、UPDATE、DELETE、MERGE、DROP、ALTER、CREATE、COMMIT、ROLLBACK…，可以抓到 CTE 裡的 DELETE、`FOR UPDATE`、SQL Server 沒有分號的 batch 裡後面的語句
  - 跳出唯讀的寫法：`READ WRITE`、改 `default_transaction_read_only`／`transaction_read_only` 等設定（包括 `set_config(…)`、`@@session.x` 的寫法）、`SET GLOBAL`、`INTO OUTFILE`，以及 SQL Server 的動態 SQL（`EXEC(…)`、`sp_executesql`）
  - 寫成函式呼叫的詞不算（MySQL 的 `insert(…)`、`replace(…)`），接在 `.` 後面的欄位名稱也不算
  - MySQL／MariaDB 的 executable comment（`/*!…*/`、`/*M!…*/`，可帶版本號）伺服器會當程式碼執行，所以照程式碼讀，裡面的 `;` 也算語句分隔；`/*+…*/` optimizer hint 和一般註解一樣跳過（2026-09-28 補上：之前 `/*!40101 SET SESSION TRANSACTION READ WRITE */` 可以把 session 改回可寫；MySQL／MariaDB 整合測試先證明繞過檢查時真的寫得進去）
  - 呼叫 procedure 一律擋（2026-09-28 補上）：procedure 可以自己 COMMIT、改掉自己 session 的唯讀設定再寫入，伺服器端的唯讀擋不住（三種伺服器都實測過）。PostgreSQL 擋 `CALL`；MySQL／MariaDB 擋 `CALL` 和 `PREPARE`／`EXECUTE`（字串裡的 SQL 看不到）
  - SQL Server 另有一組規則（`sqlserver-read-only-rules.ts`，看整個 batch）：
    - `EXEC`／`EXECUTE` 只放行 allowlist 裡的系統 procedure：`sp_help`、`sp_helptext`、`sp_helpindex`、`sp_helpconstraint`、`sp_columns`、`sp_tables`、`sp_pkeys`、`sp_fkeys`、`sp_who`。這些是只讀 metadata、沒有會寫入的參數的目錄／說明 procedure；名稱必須完全相同的小寫、不加 schema 或加 `sys.`，因為 SQL Server 對這種名稱會先找 `sys` 裡的系統 procedure，使用者自建的同名 procedure（例如 `dbo.sp_help`）接不走（有整合測試驗證）。`dbo.sp_help`、`SP_HELP`（大小寫區分的資料庫會解析到使用者的 procedure）、`EXEC @變數`、`EXECUTE AS`、`xp_cmdshell` 都擋
    - batch 開頭不是 SELECT、WITH、SET、DECLARE、IF、BEGIN、USE、EXEC 等語句關鍵字時，SQL Server 會把它當成 procedure 名稱執行（不用寫 EXEC），所以也照 EXEC 的規則擋（包括 `explain select 1`）
    - `NEXT VALUE FOR`（sequence 發出的號碼 rollback 也不會還回去）、`SELECT … INTO`（`FETCH … INTO @變數` 除外）、`OPENQUERY`／`OPENROWSET`／`OPENDATASOURCE`（在別的伺服器上執行）、`ENABLE`／`DISABLE TRIGGER`、`WRITETEXT`／`UPDATETEXT`、Service Broker 的 `SEND`／`RECEIVE`／`BEGIN DIALOG`／`END CONVERSATION`、`ADD SIGNATURE`
- **伺服器端**：
  - PostgreSQL：每條 session（包括結構資料用的）都設 `default_transaction_read_only = on`
  - MySQL／MariaDB：`SET SESSION TRANSACTION READ ONLY`
  - SQLite：一律以唯讀模式開檔
  - SQL Server 沒有唯讀 session：console 開啟隱含交易（`IMPLICIT_TRANSACTIONS ON`），每個 batch 讀完就 `ROLLBACK`（結果還沒讀完就等讀完、放棄或關閉時），避免把鎖留在資料庫上。這只是第二層：自己 COMMIT 的 procedure 和 sequence 的號碼 rollback 都救不回來，所以上面送出前的檢查才是主要保護
- **驗證**：五種資料庫的 conformance 測試都有「送出前拒絕寫入」和「繞過檢查直接交給驅動的寫入也不會留下」兩項；逐層反向驗證過，拿掉任何一層都有測試失敗。`database-read-only-procedures.integration.test.ts` 對 SQL Server、PostgreSQL、MySQL、MariaDB 先證明繞過檢查時 procedure（和 SQL Server 的 sequence）真的會寫入，再證明 console 會擋、另一條 session 看不到任何變化

已知限制：

- SQL Server 的使用者自訂函式可以呼叫 extended procedure 或 CLR，這些副作用 Orca 從 SELECT 看不出來；PostgreSQL 的 `dblink_exec` 之類的擴充函式會開自己的（可寫入）連線。要完全保證，請用唯讀登入（例如 SQL Server 只有 `db_datareader`）
- 為了唯讀，SQL Server 的 temp table（`SELECT … INTO #t`、`INSERT INTO @t`）和其他系統 procedure 都不能用；PostgreSQL 的 `CALL` 即使 procedure 只讀也會被擋
- 關鍵字檢查會擋掉少數其實是讀取的寫法，例如 `SELECT … FOR UPDATE`、名稱剛好沒加引號叫 `delete` 的欄位
- 測試資料改由測試自己另開可寫入的連線建立（整合測試用 `database-test-admin.ts`，e2e 用 `helpers/database-admin.ts`），不經過 app

SQL Server 登入失敗（2026-09-28）：tedious 的 `ELOGIN`、錯誤 18456、「Login failed for user」都當成要密碼（`password-required`），會開密碼視窗讓使用者重試（worker 的錯誤對應和 service 的連線判斷兩處都認）。`connectSqlServer` 會收集登入時伺服器送來的每一則錯誤，所以資料庫打不開時訊息會帶上 4060 的「Cannot open database …」，不只剩 tedious 保留的最後一則。資料庫打不開時伺服器先送 4060 再送 18456：只有 18456 才算密碼錯誤，前面有 4060 等其他原因時錯誤帶那個號碼（sqlState `4060`），顯示成一般連線錯誤、不開密碼視窗；service 有 sqlState 時只看它，不再用訊息文字判斷（2026-09-28 修正，之前這種情況也會開密碼視窗）

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
| D4 | v1 範圍 | 連線管理和結構樹、SQL Console 和結果表格、~~資料表直接編輯~~（2026-09-28 移除，全部唯讀，見 §0）、SSH Tunnel |
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

- SQL Server：只支援 SQL 帳號登入（沒有 Windows／Azure AD）；~~`tedious` 把 DECIMAL 轉成 JS 數字，超過約 15 位有效數字會失去精度~~（2026-09-28 修正，見 Phase 2 完成紀錄的「精確的 SQL Server 數字」）；`datetime2(7)` 只顯示到毫秒；混合批次（DML 加 SELECT）不顯示 DML 的影響列數
- MySQL：FLOAT／DOUBLE 以 JS 數字的格式顯示
- SQLite：不能建立新檔案；SSH workspace 裡遠端主機上的 SQLite 檔案還不支援

整合測試方式（伺服器用 Docker 跑，SQLite 不需要設定，每次都會跑）：

```
docker run -d --rm --name orca-db-it-mysql -p 127.0.0.1:53306:3306 -e MYSQL_ROOT_PASSWORD=orca-test-pw -e MYSQL_DATABASE=orca_it mysql:8.4
docker run -d --rm --name orca-db-it-mariadb -p 127.0.0.1:53307:3306 -e MARIADB_ROOT_PASSWORD=orca-test-pw -e MARIADB_DATABASE=orca_it mariadb:11
docker run -d --rm --name orca-db-it-mssql -p 127.0.0.1:51433:1433 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=Orca-test-Pw1 mcr.microsoft.com/mssql/server:2022-latest
# 沒有 TLS 的伺服器（像 Debian 套件裝的 MariaDB），測 SSL prefer 退回明文
docker run -d --rm --name orca-db-it-mariadb105 -p 127.0.0.1:53308:3306 -e MARIADB_ROOT_PASSWORD=orca-test-pw -e MARIADB_DATABASE=orca_it mariadb:10.5 --skip-ssl

ORCA_TEST_POSTGRES_URL=postgres://orca_test@127.0.0.1:55439/postgres \
ORCA_TEST_MYSQL_URL=mysql://root:orca-test-pw@127.0.0.1:53306/orca_it \
ORCA_TEST_MARIADB_URL=mysql://root:orca-test-pw@127.0.0.1:53307/orca_it \
ORCA_TEST_SQLSERVER_URL=sqlserver://sa:Orca-test-Pw1@127.0.0.1:51433/master \
ORCA_TEST_MYSQL_NO_SSL_URL=mysql://root:orca-test-pw@127.0.0.1:53308/orca_it \
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
- **超長值的複製和匯出（2026-09-28 修正）**：超過 10,000 字元（`DATABASE_CELL_PREVIEW_MAX_CHARS`）的值以前只把預覽寫進複製和匯出，而且照樣顯示成功。現在 driver 交出完整文字，worker 的 dispatcher（每一列離開 worker 的唯一出口）才截成預覽，並把完整文字留在 `LongValueStore`：以 console、result、從結果第一列起算的列號（跨分頁、跨後續結果集）和欄位為 key，每個 worker 上限 64M 字元，空間不夠時先丟最久沒用到的結果，單獨放不下的值不會擠掉別人，關掉 console 就一起丟。複製和匯出（CSV／TSV／JSON／SQL INSERT，選取範圍或全部已載入的列）先依每格在結果裡的位置，透過 `database:readLongValues` 分段讀回完整值：每次最多 4M 字元、1,000 段（main 用 zod 檢查），一個值可以跨多次讀取。任何一個值已經不在（被擠掉、超過上限、session 重開或中斷）就什麼都不寫，錯誤 toast 說明原因，要求重新查詢；只有真的存檔之後才顯示成功。輸出格式本身遇到預覽會丟錯，所以預覽不可能默默寫進檔案。剪貼簿 16 MB、匯出 256M 字元的上限不變，超過時在讀取前就拒絕並說明；剪貼簿寫入失敗也會回報
- **精確的 SQL Server 數字（2026-09-28 修正）**：`tedious` 把 DECIMAL／NUMERIC 算成 JS 數字（值 ÷ 10^scale），decimal(38,18) 或超過 `Number.MAX_SAFE_INTEGER` 的 numeric 在格子、複製、匯出都會變成近似值，money 超過約 9,000 億也會掉分。`config/patches/tedious@20.0.0.patch`（沿用專案既有的 pnpm patch 機制）改成從線上的位元組組出 BigInt 再依 scale 寫成文字：每一位數、scale 的尾端 0、正負號都保留；money／smallmoney 一樣處理，固定四位小數（和 SSMS 相同）。tedious 會被打包進資料庫 worker，所以要改依賴本身，執行期包一層在打包後不一定生效。值被切在封包中間時照樣丟 `NotEnoughDataError`，讓串流解析器等下一段
- **值檢視器**：`Shift+Enter`、右鍵「Show Value」或結果下方的按鈕開關，寬度可拖拉，開關和寬度都記在 localStorage。JSON 物件／陣列會排版；被截斷的值只顯示預覽和原本長度（預覽截在中間，不嘗試排版）
- **快捷鍵顯示**：右鍵選單和提示用共用的 `formatKeybinding`，Mac 顯示符號，其他平台顯示 `Ctrl`／`Shift`

已知限制：

- 被截斷的超長值，格子和值檢視器仍只顯示預覽和原本長度；複製和匯出會讀回完整值（見上面的修正）
- worker 只保留有限的完整值（每個連線 64M 字元，最新的結果優先）：結果很多或值很大時，較舊結果的複製和匯出會被拒絕並要求重新查詢。SQLite 的「取消」會重開 worker，所以取消之後，之前結果裡的超長值也需要重新查詢
- 單一複製超過剪貼簿 16 MB、匯出超過 256M 字元時會拒絕（不提高 IPC 上限），請減少選取的範圍
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

### Phase 3：資料表編輯（2026-09-28 已移除，見 §0）

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

- **重用 Orca 的 SSH**：連線用 `connectRegisteredSshTarget`（已連線就沿用、正在連線就一起等，密碼和金鑰密碼走 Orca 既有的 SSH 詢問視窗），轉發用既有的 ssh2／系統 OpenSSH provider。（2026-09-27 改為隧道自己的 SSH 連線，見下方已知限制）
- **獨立的轉發管理器**：共用的 Ports 面板轉發會被存進 SSH 主機設定、列在 Ports 面板、而且每次 relay 重連都被清掉。資料庫隧道用自己的 `SshPortForwardManager`，只跟著資料庫 session 開關
- **連不到時說清楚**：ssh2 的轉發在對方拒絕時只會默默關掉 socket，驅動只會看到「連線被關閉」。所以開隧道前先用同一條 SSH 連線試開一次通道，失敗就顯示 SSH 主機的原因
- **斷線偵測**：SSH 連線被重置或中斷時（`registerSshProviderRequestAbort`），隧道關閉並把資料庫連線標示為中斷；訊息寫「隧道已無法使用」，不說遠端程序結束（依 `ssh-execution-boundary.md`）。系統 OpenSSH 的 `ssh -L` 程序結束時也一樣。之後重新連線會重建 SSH 和隧道
- **TLS 仍驗證真正的主機**：驅動連到 127.0.0.1 的本機埠，但憑證要對原本的資料庫主機名稱驗證。pg 用 `ssl.servername`、tedious 用 `serverName`；mysql2 只會拿 `host` 當 TLS 名稱，所以 host 保留真正的名稱，socket 改由 `stream` 連到本機埠
- **畫面**：連線表單多一個「SSH tunnel」選單（已儲存的 SSH 主機；主機被刪掉時仍顯示「Removed SSH host」，不會悄悄改成直連）；結構樹的連線後面顯示「via 主機名稱」。選單最後一項「新增 SSH 主機…」會打開 Orca 原本的新增 SSH 主機視窗，存好後自動選到新主機，已填的欄位不會清掉（2026-09-28）

這一輪順便修正的問題：

- **MySQL 的 `verify-full` 沒有驗證主機名稱**（Phase 1 起）：mysql2 要另外設 `verifyIdentity` 才會比對主機名稱，原本只驗證憑證鏈
- **連線中斷訊息重複**：mysql2 自己的訊息已經以「Connection lost:」開頭，畫面上變成「Connection lost: Connection lost: …」

測試方式：`ORCA_E2E_SSH_DOCKER=1` 加上 §6.2 的資料庫環境變數，執行 `tests/e2e/database-ssh-tunnel.spec.ts`。第一次會建 SSH 測試用的 Docker 映像檔；測試會把 SSH 主機上的 node 藏起來，確認不需要 Node.js。

已知限制：

- ~~走 Orca 標準的 SSH 連線，會在 SSH 主機上部署 relay（需要 Node.js）~~ 已改：隧道用自己的 SSH 連線，只做轉發，不部署 relay，所以沒有 Node.js 的主機也能用（2026-09-27 試用回饋）
- 系統 OpenSSH 模式（ProxyJump、ProxyCommand、硬體金鑰等會用到）不能詢問密碼，要用金鑰或 ssh-agent，這是 Orca 既有的限制
- 經由隧道的 `verify-full` 已經設定成比對真正的主機名稱，但沒有用真實憑證驗證過
- SSH 重連後隧道不會自動重建，資料庫連線顯示中斷，要手動再連

### Phase 5：打磨

- SQL 自動補全（關鍵字、資料表、欄位）、格式化、查詢歷史
- 唯讀和「正式環境」標示（連線顏色）
- 結構樹補上 view、routine、索引、鍵、DDL 檢視
- 手動交易模式（Commit／Rollback 按鈕）
- 快捷鍵、繁體中文字串

### 6.7 Phase 5 完成紀錄（2026-09-27）

五項功能都做完，每項都有單元測試、五種資料庫的整合測試（PostgreSQL、MySQL、MariaDB、SQL Server、SQLite），以及 e2e 和截圖檢查；關鍵行為都做過反向驗證（拿掉實作後測試會失敗）。

- **自動補全與格式化**
  - 補全依游標所在語句判斷位置：FROM／JOIN／UPDATE／INTO 後列出資料表和 schema，`schema.` 後列出該 schema 的表，`別名.` 或 `表名.` 後列出欄位（FROM 寫在後面也認得），其他位置依序列出欄位、資料表、關鍵字（大小寫跟著打的字）
  - 需要引號的名稱依方言自動加上
  - 結構資料只在已連線時讀取，依連線快取；跑過 CREATE／ALTER／DROP／RENAME、在結構樹按 Refresh、或連線中斷時清掉快取
  - 為了知道「不寫 schema 時指的是哪個」，schema 清單多回報目前 schema：PG 的 `current_schema()`、MySQL 的 `database()`、SQL Server 的預設 schema、SQLite 的 main
  - 格式化用 `sql-formatter`，快捷鍵 `Mod+Alt+L`（DataGrip 的 Reformat Code），Monaco 的 Format Document 也可以用。一次只格式化一條語句，所以 `GO`、`DELIMITER`、語句之間的註解都不會動；解析不了的語句保持原樣並提示
  - 補全和格式化只掛在 console 的 model 上（自訂 URI scheme），不影響一般 `.sql` 檔
- **查詢歷史**
  - console 執行的語句依連線記錄，表格畫面自動產生的查詢不記錄
  - 工具列按鈕或 `Mod+Alt+E`（DataGrip 的 Browse Query History）打開可搜尋的清單，Enter 插入游標處後焦點回到 console
  - 存在 `userData/database/history/<連線>.json`，權限 0600。上限 500 筆，SQL 總量上限 2 MB，超過 64 KB 的語句不記
  - 重跑的語句移到最上面；同一連線的寫入和讀取排隊，避免兩個 console 同時完成時互相覆蓋
  - 刪除連線時一併刪除；清除歷史要在清單裡再確認一次
- **手動交易模式**
  - 每個 console 可切換 Auto-commit／Manual commit（記在分頁上）。模式隨每個請求送出，連線重建後不會悄悄變回自動提交
  - MySQL 用 `autocommit=0`，SQL Server 用 `IMPLICIT_TRANSACTIONS ON`，PG／SQLite 在需要時送 `BEGIN`；VACUUM、CREATE DATABASE、CREATE INDEX CONCURRENTLY 等不能在交易裡執行的語句不送（比照 psql）
  - 交易狀態問伺服器：PG 用空查詢同步後讀 transaction status（出錯時錯誤比最終狀態先到），MySQL 用 `DO 0` 回傳的 IN_TRANS 旗標，SQL Server 用 `XACT_STATE()`，SQLite 用 `isTransaction`
  - Auto 模式只在有交易開著、或語句可能開交易時才多查這一次；結果還在分頁讀取時不查，避免排在未完成的查詢後面卡住
  - 交易開著時不能切回自動提交（MySQL 會因此直接提交）
  - PG 出錯後的「交易失敗」狀態只能回滾，Commit 按鈕停用
  - 伺服器斷開一個有交易的 console 連線時（例如 `idle_in_transaction_session_timeout`），下一條語句會說明交易已被回滾，不會默默重連；整個連線中斷時 console 也會記錄這件事，不會在新 session 重跑語句
  - 關閉有交易的 console 會詢問：取消、回滾並關閉、提交並關閉
- **連線顏色**：沿用 repo 顏色色票（去掉中性灰）。結構樹的連線圖示上色，該連線的分頁頂端有色條，console 和表格工具列淡淡上色。改顏色不會中斷連線
- **結構樹與 DDL**
  - schema 下多 Routines（function／procedure 和參數；SQLite 沒有）。表格欄位後面多 Keys（主鍵、唯一鍵、外鍵和它指向的表）和 Indexes（欄位或運算式、是否唯一）。materialized view 只有 Indexes，view 都沒有
  - 右鍵「Show DDL」打開唯讀 SQL 編輯器，可複製
  - 伺服器有存原文的直接用：MySQL 的 SHOW CREATE、SQL Server 的 OBJECT_DEFINITION、PG 的 pg_get_viewdef／pg_get_functiondef（用 regprocedure 簽章分辨 overload）、SQLite 的 sqlite_master（連同索引和觸發器）
  - PG 和 SQL Server 的資料表從系統表重建：欄位、identity、生成欄位、預設值（SQL Server 保留約束名稱）、NOT NULL、各種約束，以及不是約束建立的索引；PG 另外處理 PARTITION BY 和 foreign table
  - 驗證方式：把兩張相關資料表和 routine 的 DDL 實際執行到另一個 schema，比對兩邊的欄位、鍵、索引、routine 完全一致

這一輪順便修正的問題：

- **選交易模式後焦點被搶走**：選單關閉時把焦點還給選單按鈕，選完立刻打字會打到一半被打斷（完整 e2e 抓到的，console 裡只剩「select」）。改成焦點回到 console

試用回饋後的調整：

- **console 選擇資料庫／schema**：MySQL/MariaDB 和 PostgreSQL 的工具列有下拉選單（MySQL 用 `USE`，PG 設 `search_path` 並保留 public）。從結構樹的資料庫節點開 console 會預設選中它；沒設預設資料庫的連線顯示「選擇資料庫」。console 裡自己執行 `USE`／`SET search_path` 時選單會跟著更新；補全也以選中的為準。交易進行中鎖住（PG 的 SET 會隨回滾撤銷）。SQL Server、SQLite 不顯示
- **唯讀連線有鎖頭圖示**：結構樹和工具列
- **FROM 後只列目前資料庫的表**：有目前資料庫時不再列其他資料庫名稱（Monaco 先依模糊比對排序，庫名會排到表名前面）；沒有時才列庫名讓人先選

已知限制與觀察：

- 手動模式下連讀取也會開交易（和 DataGrip 相同），所以會一直顯示「交易進行中」直到提交或回滾
- DDL 重建不含註解（COMMENT）、權限、擁有者、觸發器（SQLite 例外）；SQL Server 的叢集／非叢集只區分索引，不區分主鍵
- 一次完整 e2e 在機器負載很高時（比平常慢一倍），MariaDB 的 `call` 沒有產生結果、30 秒逾時；之後單獨跑 3 次、完整跑 2 次都無法重現，原因不明

第二輪試用回饋（2026-09-28）：

- **沒有 Node.js 的 SSH 主機也能開隧道**：見 §6.6 已知限制
- **SQL Server console 可切換資料庫**：工具列的「Database」選單用 `USE` 切換，console 裡自己打的 `USE` 也會反映到選單；結構資料和 DDL 在元資料連線上先 `USE` 到目標資料庫再讀
- **新增連線的入口**：結構樹上方的「Connections」標題列有 + 按鈕，空白處按右鍵也能新增
- **zh-TW 用語**：新增覆寫規則，file type 固定譯為「檔案類型」
- **資料庫欄位可以留空，留空時列出伺服器上所有資料庫**
  - MySQL 本來就是這樣（資料庫就是 schema）。PG 和 SQL Server 的結構樹在連線下多一層資料庫，底下的 schema、表、routine 都從該資料庫讀；表格分頁記得資料庫；資料庫節點的 New Console 直接開在該資料庫
  - 新的伺服器連線預設不填資料庫，欄位顯示「All databases」
  - PG 的一條連線只能在一個資料庫，所以：讀其他資料庫的結構時第一次用到才另開元資料連線；console 換資料庫時重新連線，交易進行中會先要求提交或回滾；沒填資料庫時從 `postgres` 維護資料庫進入
  - PG 的 console 在這種連線上同時有 Database 和 Schema 兩個選單，換資料庫時 schema 回到該資料庫的預設
  - 結果欄位的型別名稱在結果所在的資料庫查（enum、domain 的 OID 各資料庫不同）
- **SSL `prefer` 連不上沒有 TLS 的 MySQL／MariaDB**：測試連線 OK，實際連線卻顯示「Connection was closed」。`prefer` 先試 TLS，伺服器沒有 TLS（Debian 套件裝的 MariaDB 預設如此）時改用明文；但被拒絕的那次嘗試被當成「連線中斷」回報，測試連線會忽略這個通知，實際連線則把 session 關掉。改成連上之後才回報中斷；連線途中被中斷時也改為顯示真正原因。原本所有整合測試都用 `disable`，所以沒測到；補了 `mariadb:10.5 --skip-ssl` 的整合測試和 e2e
- **DROP／ALTER DATABASE 前放開 Orca 自己的閒置連線**：瀏覽過的資料庫會被 Orca 的元資料連線佔住，DROP 會回「正在使用中」；SQL Server 的 `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` 還會把元資料連線踢掉、讓整條連線斷掉。執行這兩種語句前先放開（PG 關掉該資料庫的元資料連線，SQL Server 把元資料連線 `USE` 回預設資料庫）。其他 console 的連線屬於使用者，不動

### Phase 6：Dump、匯出（2026-09-28 改為唯讀：6.1 執行 SQL 腳本已移除，見 §0）

使用者的決定（2026-09-28）：

- Dump 兩種都要：預設用 Orca 內建的產生器，本機有 `pg_dump`／`mysqldump` 時可以改用原生工具
- 匯出資料只要 SQL INSERT 一種格式
- 匯入只要「執行 SQL 腳本檔」（匯回 dump 也走這條路）；CSV／Excel 匯入不做
- 一定要有的選項：dump 成 SQL 時可勾「暫時解除外鍵約束」；dump／匯出可選「每張表一個檔案」或「全部合成一個檔案」

**架構：背景工作（job）**

- dump、匯出、執行腳本都是背景工作，在該連線的 worker 裡用自己的伺服器 session（專用的 console id），不會卡住畫面上的 console 和表格
- worker 直接讀寫檔案：資料一頁一頁讀、一邊寫出，不把整張表或整個腳本載入記憶體
- 路徑由 main 的存檔／選資料夾／開檔對話框取得並檢查後交給 worker
- 進度（第幾張表、幾列、腳本讀到第幾個位元組和第幾條語句）透過事件推到畫面，可以取消
- 資料庫頁面有「工作」清單：進行中的顯示進度和取消鈕，完成的顯示摘要和「在 Finder 中顯示」
- 入口在結構樹右鍵：連線、資料庫、schema、資料表節點都有「Dump to SQL…」「Export Data…」（「Run SQL Script…」已隨唯讀方向移除）

**6.1 執行 SQL 腳本（已移除）**

- 可以一次選多個 `.sql` 檔，依檔名順序在同一個 session 執行，所以「每張表一個檔案」的 dump 能一次匯回；可以指定目標資料庫（列出全部資料庫的連線）
- 串流讀檔、逐段切分語句：沿用現有的分句器（引號、註解、PG 的 `$$`、MySQL 的 `DELIMITER`、SQL Server 的 `GO`），跨讀取區塊時要保留 DELIMITER 狀態，最後一段沒結束的語句留到下一塊
- 選項：遇錯停止（預設）或繼續並記錄；包成一個交易（預設關，CREATE DATABASE 之類不能在交易裡執行）
- 結果：執行了幾條、失敗幾條、耗時；錯誤附檔名和行號，失敗的前幾條可以展開看
- SELECT 的結果不顯示，只計列數

**6.1 完成紀錄（2026-09-28）**

- 結構樹的連線、資料庫、schema 右鍵「Run SQL Script…」：選檔（可多選，依檔名的數字順序排列）、遇錯停止或繼續、包成一個交易。從資料庫或 schema 開啟時就在那裡執行（PG 設 search_path，MySQL `USE`）
- 頁首的「Jobs」按鈕：執行中顯示進度條（已執行到的位置，不是已讀取的量）、目前第幾個檔案、語句數和錯誤數，可以取消；完成後顯示摘要、交易結果（已提交／已回滾）和前 5 個錯誤（檔名:行號 與訊息）。完成時跳 toast，結構樹已展開的節點和補全快取都會重新載入
- 選檔在 main 的對話框完成，畫面只拿到一個 token（一小時有效），不能自己指定路徑
- 腳本自己開了交易卻沒結束時，會回滾並在摘要註明，不會默默丟失
- 驗證：分句器用每一種區塊大小切同一份腳本，結果都和一次切完相同（MySQL DELIMITER、SQL Server GO、PG `$$`、SQLite trigger）；四種資料庫的整合測試（方言語法、遇錯繼續、交易回滾與提交、取消）；e2e（SQLite 的多檔順序、錯誤清單、交易回滾；PG 的進度和取消）；反向驗證了 DELIMITER 狀態、行首狀態、進度計算

已知限制：

- 只讀 UTF-8（開頭的 BOM 會略過）
- SQL Server 腳本沒有 `GO` 時整份是一個 batch（和 SSMS 相同），超過 64 MB 會拒絕執行並說明
- SQLite 的語句無法中途中斷，取消會等目前這條跑完
- SQLite：另一個分頁還沒讀完的結果（例如超過 500 列的表格）會佔住讀取鎖，腳本的寫入會等 5 秒後失敗（database is locked）。這是 SQLite 多連線的既有限制，console 和表格編輯也一樣
- zh-TW 新增覆寫規則「後台任務 → 背景任務」，順帶修正了上游 6 處同樣的用詞

**6.2 內建 dump／匯出**

- 對話框：勾選要 dump 的物件（schema、表、view、routine），內容選「結構加資料／只有結構／只有資料」（只有資料就是「匯出資料（SQL INSERT）」），每條 INSERT 幾列，要不要先 DROP，單一檔案或每表一檔
- 輸出順序：session 設定 → schema、型別、sequence → 資料表（依外鍵相依排序）→ 資料 → 延後的外鍵 → view（依相依排序）→ routine → trigger → 還原 session 設定
- 「暫時解除外鍵約束」各資料庫的做法：
  - MySQL／MariaDB：開頭 `SET FOREIGN_KEY_CHECKS=0`，結尾設回 1（和 mysqldump 一樣）
  - SQLite：開頭 `PRAGMA foreign_keys=OFF`，結尾 ON（SQLite 不能事後加外鍵，所以外鍵仍寫在 CREATE TABLE 裡）
  - PostgreSQL、SQL Server：沒有不需要高權限的 session 開關，所以改成建表時不含外鍵，資料匯完才 `ALTER TABLE … ADD CONSTRAINT`（和 pg_dump 一樣）；加上時會檢查既有資料
  - 沒勾時依外鍵相依順序建表；遇到循環參照時仍把那幾條外鍵延後，並在檔頭註明
- 每表一檔：依相依順序編號（`001_schema.table.sql`…），另有開頭檔（schema、型別、sequence）和結尾檔（延後的外鍵、view、routine、trigger）。每個檔都自帶 session 設定，單獨執行也成立
- 要補齊的 DDL（現在的 Show DDL 缺這些，dump 後匯不回去）：PG 的 sequence（含 serial 欄位用的）、enum／domain／composite 型別、trigger、sequence 目前值（`setval`）；SQL Server 的 trigger、使用者定義型別、sequence，identity 資料用 `SET IDENTITY_INSERT`；MySQL 的 trigger、event
- 值的寫法沿用現有的 `sqlLiteral`（二進位、大數字、日期、JSON 都要保留原樣）

**6.2 完成紀錄（2026-09-28）**

- 結構樹右鍵：連線、資料庫、schema、資料表（和 view）都有「Dump to SQL…」；除了 view 之外也都有「Export Data…」（只寫 INSERT，清單只列資料表）。從資料表開啟時只勾那一張，其他照樣列出可以加選
- 對話框：依名稱篩選、全選／全不選、多個 schema 時可整組勾選；內容（結構加資料／只有結構／只有資料）、單一檔案或每表一檔、每條 INSERT 幾列（預設 100，上限 1000）、停用外鍵檢查（預設勾）、先 DROP。按「Save As…」或「Choose Folder…」才開原生對話框；每表一檔會在選的資料夾裡另開一個新資料夾（同名就加「 (2)」），不會跟既有檔案混在一起
- 選好的位置只以 token 交給畫面（一次有效、一小時過期），畫面不能自己指定路徑；版面和位置種類不符（例如選了檔案卻要每表一檔）會拒絕
- 背景工作：每個 dump 在連線的 worker 裡開自己的連線（沿用 SSH 隧道轉好的位址），不佔用 console。頁首「Jobs」顯示進度（第幾張表、列數、已寫出的大小），可以取消；完成後顯示摘要、說明（dump 無法完整保留的地方）和「在資料夾中顯示」。中斷連線時會先取消進行中的 dump、等它清掉檔案
- 輸出的生命週期（2026-09-28 修正）：dump 先寫進同一個資料夾裡的隱藏暫存檔（`.<檔名>.<job id>.partial`；每表一檔則是同名的隱藏暫存資料夾），全部寫完、fsync 之後才原子地 rename 成正式檔名（覆寫既有檔案也是這一步才發生），最後 fsync 所在資料夾。失敗或取消只刪掉暫存檔，原本的檔案保持完整；worker 中途死掉時由 main 依 job id 刪掉暫存檔；正常結束 Orca 時也會刪掉進行中 dump 的暫存檔。crash 時可能留下隱藏的 `.partial`，但不會出現看起來完整的 `.sql`。等待開檔和 drain 改用 `events.once`，錯誤由一個固定的 listener 記下，大型 dump 不再累積 error listener
- 讀取方式：PostgreSQL 用 `REPEATABLE READ READ ONLY` 的快照；MySQL／MariaDB 用 `WITH CONSISTENT SNAPSHOT, READ ONLY`，時間以 UTC 讀寫；SQLite 用一個讀取交易；SQL Server 在資料庫允許時用 `SNAPSHOT` 交易，不允許就逐表讀並在說明裡註明
- 值：PostgreSQL 一律以 `::text` 讀出；MySQL 以字串讀、二進位用 `HEX()`；SQL Server 的時間用 ISO 8601（style 126，不受 DATEFORMAT 影響）、money 保留 4 位小數、float 以指數寫法、二進位用 `0x…`，字串裡結尾是反斜線的那一行會拆開寫（T-SQL 會把行尾的反斜線當成接續字元吞掉）
- 自動編號：PG `setval`、GENERATED ALWAYS 用 `OVERRIDING SYSTEM VALUE`；MySQL 靠 `AUTO_INCREMENT` 和 `NO_AUTO_VALUE_ON_ZERO`；SQLite 寫回 `sqlite_sequence`；SQL Server 用 `SET IDENTITY_INSERT`，最後 `DBCC CHECKIDENT … RESEED` 到原本的值
- SQL Server 的建表 DDL 補齊（Show DDL 也受益）：外鍵的 ON DELETE／ON UPDATE、主鍵和唯一鍵的 CLUSTERED／NONCLUSTERED、索引的 DESC、INCLUDE 和篩選條件、非預設的欄位定序、使用者定義型別加上 schema；dump 另外寫出別名型別（`CREATE TYPE … FROM`）、trigger（停用的照樣停用）
- SQL Server 的 sequence（2026-09-28 修正）：資料表的 default constraint 用 `NEXT VALUE FOR` 取號時，那個 sequence 放進這張表的 requires，在 CREATE TABLE 之前 `IF OBJECT_ID(…, 'SO') IS NULL CREATE SEQUENCE`，帶上型別（別名型別會先建）、START WITH、INCREMENT BY、MINVALUE／MAXVALUE、CYCLE、CACHE；幾張表共用同一個 sequence 時只寫一次（沿用 runner 對 requires 的去重）。找 sequence 用 `sys.sql_expression_dependencies`，因為預設值的原文可能沒寫 schema。目前狀態寫在第一張用到它的表的資料之後（sequence 不受交易影響，這時讀到的值一定不小於資料裡的任何號碼）：用 `sp_sequence_get_range` 從起始值一次取走來源已經發出的個數，所以起始值、目前值、下一個值都和來源相同，繞回過的 cycle 和已經用完的 sequence 也一樣。`ALTER SEQUENCE … RESTART` 只在匯入端的 sequence 已經動過時才執行（它會把別名型別的 sequence 改成基底型別），同一份 dump 重匯時發現已經在正確狀態就不動
- MySQL／MariaDB 的 stored object（2026-09-28 修正）：trigger、procedure、function 都照 SHOW CREATE 回報的 sql_mode、character_set_client、collation_connection 重建：建立前把 session 的這幾個值存進變數並換成物件自己的，建立後換回來，所以用 ANSI_QUOTES、NO_BACKSLASH_ESCAPES 寫的物件匯入後語意相同。資料和建表仍用 `NO_AUTO_VALUE_ON_ZERO`（和 mysqldump 一樣，這是 dump 自己產生的 SQL 的讀法），不再套到 stored object 上。view 沒有 sql_mode，只帶字元集和定序。物件建立時的資料庫預設定序跟來源現在不同時，前後 `ALTER DATABASE COLLATE`，最後設成來源的（mysqldump 的做法，說明裡會註明）。NO_BACKSLASH_ESCAPES 的 routine，SHOW CREATE 仍用反斜線跳脫 COMMENT，dump 會改寫成該模式讀得對的寫法。dump 自己的連線改用空的 sql_mode 讀（伺服器預設有 ANSI_QUOTES 時 SHOW CREATE TABLE 會用雙引號，匯入端讀不懂）；每個檔的開頭另外記下並在結尾還原使用者的 character_set_client／results、collation_connection，連同原本就還原的 sql_mode、time_zone、外鍵檢查，匯入結束後 session 和開始前一樣
- 只匯資料又停用外鍵檢查時：MySQL／SQLite 用 session 開關；PostgreSQL 用 `session_replication_role = replica`（需要超級使用者，說明裡會註明）；SQL Server 逐表 `NOCHECK` 那張表自己的外鍵、資料匯完再開回（不重新檢查，SQL Server 會把它標成 not trusted，說明裡會註明）
- sequence 和 stored object 的驗證：SQL Server 的來回測試加了四個 sequence（兩張表共用、遞減 cycle 且已繞回、tinyint 已用完、只有 sequence 用到的別名型別且沒用過），比對 `sys.sequences` 的每個欄位和匯入後實際取出的下兩個值；MySQL／MariaDB 另有一組在 ANSI_QUOTES + NO_BACKSLASH_ESCAPES、latin1_german2_ci、舊的資料庫定序下建立的 function／procedure／trigger／view，比對 ROUTINES／TRIGGERS／VIEWS 的 session 欄位、COMMENT、原文，實際呼叫比對結果，並用一個 sql_mode、time_zone、字元集都不同的 session 匯入、確認結束後完全還原。逐項反向驗證過（拿掉建 sequence、拿掉狀態、拿掉 context、拿掉 COMMENT 改寫、拿掉資料庫定序切換、拿掉字元集還原、拿掉空 sql_mode、trigger 沒有 DELIMITER，都有測試失敗）
- 驗證：四種資料庫各自的來回測試（dump → 匯進空資料庫 → 比對結構、每張表的內容、自動編號的下一個值、view、routine、trigger），涵蓋單一檔案／每表一檔、停用／不停用外鍵、只有結構加只有資料、DROP 後重匯；SQL Server 另測串流中途取消後連線仍可用；worker 測試（進度事件、取消、關閉時先取消）；3 個 e2e（整個 SQLite 資料庫 dump 後匯回比對、單表匯出成每表一檔、取消大型 dump 後檔案被刪除），加上全部資料庫 e2e 30 個通過（SSH 的 2 個需要 Docker SSH 主機，這輪沒跑）。反向驗證了 SQL Server 的 reseed、反斜線、money、時間格式、外鍵動作、NOCHECK、取消時等待請求結束，以及 worker 關閉前先取消

已知限制：

- PostgreSQL 的分割表只寫出父表，分割區不在 dump 裡，所以資料要匯進已經有分割區的資料庫（說明裡會註明）
- 只匯資料時，SQLite、MySQL、SQL Server 匯入端既有的 trigger 會被觸發
- PostgreSQL 的 `CREATE TYPE` 沒有 IF NOT EXISTS，重複匯入到已有同名型別的資料庫會失敗
- 資料表預設值用到的 routine 不會排在那張表之前
- SQL Server：view／routine 的定義照伺服器存的原文寫出，建立時沒寫 schema 的物件會建到匯入者的預設 schema；XML、空間、columnstore 索引、CLR 型別（assembly）不在 dump 裡；sql_variant 以文字寫出（說明裡會註明）
- SQLite 的連線如果在 console 取消長語句，worker 會重開，進行中的 dump 也會跟著失敗（main 會刪掉它的暫存檔，原本的檔案不動）
- Orca crash（或被強制結束）時，進行中 dump 的隱藏 `.partial` 暫存檔會留在目的地資料夾，需要手動刪除
- 成功覆寫既有檔案後，新檔案用的是新建檔案的權限，不沿用原檔的權限
- SQL Server 的 sequence：只匯結構時從起始值開始（目前值跟 identity 一樣算資料，和 pg_dump 相同）；只帶 default constraint 用到的 sequence，trigger、routine 裡用到的不會；沒有 VIEW DEFINITION 的使用者看不到 sequence 也看不到預設值原文，dump 出的表就沒有那個預設值；匯入到狀態不同的既有同名 sequence 時會 RESTART，別名型別的 sequence 會變成基底型別（SQL Server 的行為）；SQL Server 2017 以前沒有 `last_used_value`，停在起始值的 sequence 分不出用過沒有，當成用過（說明裡會註明）；目前值從起始值走不到（increment 事後改過）時從目前值重新開始，起始值會變（說明裡會註明）
- 匯入端已有同名 sequence 但定義（型別、INCREMENT、MINVALUE／MAXVALUE、CYCLE、CACHE）不同時（2026-09-28）：PostgreSQL 和 SQL Server 在 CREATE SEQUENCE 前先檢查，不會留下定義不同的 sequence。沒勾先 DROP 就報錯停止；勾了先 DROP 且沒有其他物件使用（PostgreSQL 看 `pg_depend`，SQL Server 看 `sys.sql_expression_dependencies`）就刪掉重建；有其他物件使用就報錯停止。SQL Server 比較基底型別，因為 RESTART 會把別名型別改成基底型別
- MySQL／MariaDB 多個資料庫的 dump 勾了先 DROP 時，`DROP TABLE` 寫成 `資料庫.表`，不會刪到匯入 session 目前資料庫裡的同名表；單一資料庫的 dump 仍不寫資料庫名，才能匯進任何資料庫（2026-09-28 修正）
- MySQL／MariaDB：view 不記 sql_mode，欄位的中繼資料（例如 `collation()` 的可否為 NULL）依匯入時的模式推導，可能和來源不同（mysqldump 也一樣）；物件的資料庫定序和來源現在不同時，匯入後資料庫的預設定序會變成來源的；character_set_client 不是 UTF-8 又含非 ASCII 字元的物件，因為 dump 是 UTF-8，改用 utf8mb4 讀入，內容相同但記錄的 character_set_client 會是 utf8mb4（說明裡會註明）

**6.3 原生工具（pg_dump／mysqldump）**

- 偵測 PATH 和常見安裝位置（Homebrew、Postgres.app、Windows 的 Program Files），也可以在設定裡指定路徑；SQL Server 和 SQLite 沒有對應工具，不提供
- 一律用 `src/shared/child-process/` 的 `spawnProcess`；密碼用 `PGPASSWORD` 環境變數，MySQL 用只有目前使用者能讀的暫存設定檔（`--defaults-extra-file`），不放在命令列
- 走 SSH 隧道的連線，為這個工作另開隧道，工具連到本機埠
- 選項對應：每表一檔就逐表執行（`pg_dump -t`、`mysqldump db table`）；外鍵選項對應工具本身的行為（mysqldump 預設就關外鍵檢查，pg_dump 預設把外鍵放在資料之後）
- pg_dump 版本比伺服器舊時會拒絕執行，要把工具的訊息原樣顯示

**6.3 完成紀錄（2026-09-28）**

- Dump 對話框多一個「Tool」：PostgreSQL、MySQL／MariaDB 連線可以選「Orca（內建）」或偵測到的 `pg_dump 17.9`／`mysqldump 8.4.3`，下面顯示工具的完整路徑。找不到時該選項停用並說明要安裝；pg_dump 比伺服器舊時也停用，並說明要裝哪一版。SQLite、SQL Server 不顯示這個欄位
- 偵測：PATH 加上常見位置（macOS 的 Homebrew `opt/libpq`、`opt/postgresql@*`、`opt/mysql*`、`opt/mariadb*`、Postgres.app、`/usr/local/mysql*`；Linux 的 `/usr/lib/postgresql/*/bin`、`/usr/pgsql-*`；Windows 的 Program Files 下的 PostgreSQL、MySQL Server、MariaDB），用 `--version` 判斷版本和來源（MySQL 或 MariaDB 的用戶端），挑最新的；MySQL 連線優先挑跟伺服器同來源的用戶端。每次開對話框和開始 dump 時都重新偵測，不另做設定頁的路徑欄位（原計畫的「在設定裡指定路徑」沒做）
- 在連線的 worker 裡用 `spawnProcess` 執行，工具連的是 worker 本身連的位址：走 SSH 隧道的連線就連同一條隧道的本機埠（沒有另開隧道，隧道本來就接受多條連線）。工具的輸出直接串流寫進檔案（受磁碟速度節制），進度顯示已寫出的大小和第幾張表（工具不回報列數，所以不顯示列數）；取消會結束工具，失敗會顯示工具最後幾行錯誤訊息，兩者都會刪掉已寫出的檔案
- 密碼：PostgreSQL 用 `PGPASSWORD`；MySQL 寫進暫存 `[client]` 設定檔，用 `--defaults-extra-file` 帶入。都不出現在命令列。設定檔用 `src/shared/secure-file.ts` 的 `writeSecureFile` 寫在自己的暫存資料夾（`orca-mysqldump-<pid>-…`）裡：POSIX 是 0600（資料夾 0700），Windows 在檔案以正式名稱出現之前就設好只有目前使用者的 ACL；限制沒有成功就不寫、不執行 dump。正常完成、失敗、取消都由 plan 的 cleanup 刪掉；Orca crash 留下的資料夾（pid 已不存在）會在下一次 mysqldump 前清掉
- pg_dump：`--no-owner --no-privileges`（跟內建 dump 一樣，誰匯入就屬於誰）、INSERT 格式（`--rows-per-insert`，pg_dump 12 以前只能一列一條並註明）、`--clean --if-exists`、只匯資料加停用外鍵時用 `--disable-triggers`（需要超級使用者，說明裡會註明）。環境變數 `PGOPTIONS=-c default_transaction_read_only=on`，伺服器照樣擋寫入。走隧道時 `--host` 用原本的主機名、`PGHOSTADDR=127.0.0.1`，TLS 仍然對原主機驗證。整個 schema 都勾選時用 `-n`（包含型別、函式、sequence），只勾部分時用 `-t` 並註明 pg_dump 不會帶上這些表用到的型別和函式；只勾了 routine 沒有其他物件時會拒絕並說明
- pg_dump 每表一檔：開頭檔 `--section=pre-data`，每張表一個 `--section=data -t 表` 的檔，結尾檔 `--section=post-data`（加上沒有表擁有的 sequence 值）。勾了先 DROP 時，開頭檔先刪掉這些表的外鍵（pg_dump 把外鍵放在 post-data，否則重匯時 DROP TABLE 會被擋）
- mysqldump：`--single-transaction --no-tablespaces --hex-blob --protocol=TCP`；MySQL 用戶端加 `--set-gtid-purged=OFF`，8.0 以上加 `--skip-column-statistics`（否則對 MariaDB 伺服器會失敗），不加密時加 `--get-server-public-key`（MySQL 8 預設的登入方式沒有 TLS 時需要）。SSL：MySQL 用戶端用 `--ssl-mode`；MariaDB 用戶端沒有 "prefer"，先用 TLS 連、失敗且還沒寫出任何東西時改用不加密重試。每條 INSERT 一列時用 `--skip-extended-insert`，其餘由 mysqldump 依大小分批（對話框有說明）。沒勾先 DROP 時加 `--skip-add-drop-table`。多個資料庫時每段前面加 `CREATE DATABASE IF NOT EXISTS`／`USE`
- mysqldump 每表一檔：每張表一個檔，view 全部放在一個檔（mysqldump 只在同一次執行裡處理 view 之間的相依），routine 一個檔
- 驗證：本機的 pg_dump 17.9 和 mysqldump 8.4.3（官方版）對測試用的 PostgreSQL 17、MySQL 8.4、MariaDB 11.8 做來回測試，用工具旁邊的 psql／mysql 匯入空資料庫再比對（跟內建 dump 用同一份 fixture 和比對方式）：單一檔案、每表一檔重匯兩次、只有結構加只有資料；單元測試涵蓋偵測和版本選擇、兩種工具的參數、密碼設定檔的跳脫、執行器（輸出、錯誤訊息、TLS 重試、取消）；e2e：PostgreSQL 和 MySQL 用原生工具 dump、SSH 隧道 e2e 裡兩種工具都透過隧道 dump 成功（SSH 主機上沒有 node）。反向驗證了 per-table 的 `--exclude-table-data`、先刪外鍵、view 放同一檔、`--skip-column-statistics`。全部資料庫 e2e 34 個通過

已知限制：

- MariaDB 自己的 `mariadb-dump` 本機沒有，那條路徑（`--ssl`／`--skip-ssl` 和 TLS 重試）只有單元測試
- mysqldump 會保留 view、routine、trigger 的 DEFINER，用別的帳號匯入需要相應權限（說明裡會註明）；每表一檔時每次執行各自一個快照，表之間讀到的時間點略有不同（說明裡會註明）
- 走 SSH 隧道又設 verify-full 時，mysqldump 只能拿 127.0.0.1 驗證憑證，會直接拒絕並建議改用內建 dump 或 require
- pg_dump 17.6 以後的純文字檔開頭有 `\restrict`，只能用 psql 匯入

**驗證方式**

- 來回測試（每種資料庫）：建一組含外鍵循環、自我參照、PG 的 enum 和 serial、SQL Server 的 identity、trigger、互相依賴的 view、routine、各種特殊值（NULL、引號、換行、二進位、超大數字、JSON、時區）的 schema → dump → 用「執行 SQL 腳本」匯進空資料庫 → 比對結構和每張表的內容。單一檔案／每表一檔、解除外鍵勾／不勾都要跑
- 執行腳本：跨讀取區塊的語句、DELIMITER、GO、遇錯停止／繼續、交易回滾、取消
- e2e：對話框流程、產生的檔案、工作清單的進度和取消

### Phase 7：註解與屬性（2026-09-28）

- 註解（comment）：introspection 的表和欄位多了 `comment`（PostgreSQL 的 `obj_description`／`col_description`、MySQL／MariaDB 的 `TABLE_COMMENT`／`COLUMN_COMMENT`、SQL Server 的 `MS_Description`，SQLite 沒有）。MySQL 的 view 的 TABLE_COMMENT 一律是 'VIEW'，當成沒有註解
- 顯示位置：explorer 的表名和欄位型別後面（淡色、換行收成空白、最寬 20rem，完整內容在 title）；資料表分頁的欄位標題 tooltip（名稱＋換行＋註解；console 結果沒有）；屬性對話框
- Show DDL 和內建 dump 保留註解：PostgreSQL 在 CREATE 之後寫 `COMMENT ON TABLE|VIEW|MATERIALIZED VIEW|FOREIGN TABLE|COLUMN|FUNCTION|PROCEDURE`；SQL Server 寫 `EXEC sys.sp_addextendedproperty @name = N'MS_Description', …`（dump 裡各自一個 GO batch，Show DDL 的 view／routine 後面先接 GO）；MySQL／MariaDB 本來就在 SHOW CREATE 裡。來回測試比對註解
- 屬性（右鍵「屬性…」，連線、資料庫、schema、表／view）：唯讀，在 metadata session 讀取，某一項讀不到（權限、版本）只略過並寫在對話框底部，不整個失敗
  - 連線：伺服器版本、預設字元集／定序、預設引擎、時區等，加上連線目前資料庫
  - 資料庫：MySQL 的字元集／定序／加密，PostgreSQL 的 owner／encoding／collate／ctype／locale provider／tablespace／大小，SQL Server 的定序／相容性層級／復原模式／快照設定／大小，SQLite 的檔案／編碼／page size／journal mode 等
  - 表／view：MySQL 的引擎／row format／定序／AUTO_INCREMENT／估計列數／大小，PostgreSQL 的 owner／persistence／access method／reloptions／分割／RLS／大小，SQL Server 的 filegroup／memory-optimized／temporal／lock escalation／列數／大小，SQLite 的 STRICT／WITHOUT ROWID；另有欄位表（型別、可 NULL、預設值、字元集、定序、註解）
  - MySQL 8 的 information_schema 統計預設快取一天，讀表屬性時暫時把 `information_schema_stats_expiry` 設成 0，讀完還原
  - SQL Server 的大小需要 VIEW DATABASE STATE，只有 db_datareader 的帳號看不到大小（整合測試驗證）
- explorer 不再截斷名稱和型別，改成橫向捲動：每列回報自己的完整寬度，內層寬度取最寬的一列並依列記住，上下捲動時捲軸長度不跳
- 驗證：四種伺服器的 live 整合測試（註解、DDL、dump 來回、屬性），e2e `database-properties.spec.ts`（SQLite 屬性和橫向捲動、PostgreSQL 的樹／欄位標題／屬性裡的註解）

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
