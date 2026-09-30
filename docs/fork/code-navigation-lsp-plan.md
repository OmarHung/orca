# 編輯器程式碼跳轉（LSP）：實作計畫（fork 專屬）

> 狀態：Phase 1 完成（2026-09-30），紀錄見 §8；Phase 2、3 未開始
> 分支：`feat/code-navigation`（worktree `/Users/omar/myprojects/orca-code-nav`），完成後 fast-forward 回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 目標

在 Orca 的檔案編輯器（Monaco）裡，對 C#（.NET）、TypeScript、JavaScript 做到跟 IDE 一樣的跳轉：

- F12 或 Cmd/Ctrl+click：跳到定義，目標在別的檔案時直接開 Orca 分頁並定位
- Shift+F12：找所有參照，用 Monaco 的 peek 視窗預覽，點選項目開分頁
- Cmd/Ctrl+F12：跳到實作（C# 的介面→實作類別最常用）

## 2. 已確定的決策

| # | 決策 | 內容 |
|---|---|---|
| D1 | 做法 | 接 LSP（語言伺服器），不是把專案檔餵給 Monaco 內建的 TS worker（大專案吃記憶體、tsconfig paths 解析不準、C# 做不到） |
| D2 | 範圍與順序 | Phase 1 本機 TS/JS + C# 的定義／參照／實作；Phase 2 懸停提示、符號大綱、C# 反編譯的 metadata；Phase 3 SSH／WSL |
| D3 | 伺服器取得方式 | 跟除錯器一樣：第一次用到時自動下載，SHA-256 驗證，裝在 `userData/language-servers/` |
| D4 | 降低 upstream 衝突 | 新程式放在新目錄（`main/code-navigation/`、`renderer/src/lib/code-navigation/`）；upstream 檔案只加掛載點 |

## 3. 語言伺服器的選擇（2026-09-30 實測）

### 3.1 TS／JS：TypeScript 7 原生版（`tsc --lsp --stdio`）

npm 上的 `typescript` latest 已是 7.0.2（Go 原生版），`tsc` 內建 LSP。選它而不是 `typescript-language-server` + tsserver：

- 標準 LSP，不需要中介層，也不需要 Node（不用跑 Electron-as-Node）
- 實測在 Orca repo 本身：initialize 38ms，第一次跳到定義 1.25 秒（含載入整個專案），參照 70ms
- 每個平台一個 npm 套件 `@typescript/typescript-<platform>-<arch>`（約 9 MB），執行檔是 `package/lib/tsc`（Windows 為 `tsc.exe`），`lib.*.d.ts` 就在旁邊

雜湊對過 npm 的 sha512 integrity。

### 3.2 C#：csharp-ls 0.28.0（不是微軟的 Roslyn LanguageServer）

兩個都實測過（主控台 + 類別庫的 `.slnx`，跨專案跳到定義、3 個參照，兩者結果相同，載入都約 5 秒）。選 csharp-ls 的原因：

- **下載來源**：Roslyn LanguageServer 不在 nuget.org。VS Code C# 擴充目前用的 5.12.0 在任何公開 feed 都下載不到；公開的 `vs-impl` feed 最新只到 5.4.0（2026-03），網址是 Azure DevOps 的 GUID 路徑，版本可能被清掉。csharp-ls 在 nuget.org，套件發布後不會被刪除
- **大小**：21.6 MB，Roslyn neutral 套件是 42 MB
- **簡單**：自己找 root 底下的 `.sln`／`.slnx`／`.csproj` 載入；Roslyn 需要 client 送自訂的 `solution/open`
- 兩者底層都是 Roslyn，定義／參照／實作的品質相同

需求：使用者的 `dotnet`（PATH 上）要有 .NET 10 runtime 和 SDK（MSBuild 載入專案用）。以 `DOTNET_ROLL_FORWARD=Major` 允許更新的主版本。csharp-ls 是 MIT 授權。

### 3.3 manifest（`main/code-navigation/language-server-manifest.ts`）

| 套件 | 版本 | 來源 |
|---|---|---|
| `@typescript/typescript-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64,win32-arm64}` | 7.0.2 | registry.npmjs.org |
| `csharp-ls`（`.nupkg`，zip） | 0.28.0 | api.nuget.org |

## 4. 現有架構（調查結果）

路徑都相對於 `src/`。

- **Monaco 設定**：`renderer/src/lib/monaco-setup.ts` 用內建 TS worker 做上色，錯誤檢查全關。worker 只看得到已開的 model，所以跨檔案跳轉做不到；也沒有註冊 `registerEditorOpener`，Monaco 找到別的檔案也打不開。
- **model URI**：`components/editor/editor-model-uri.ts` 的 `toEditorModelUri(path)` = `URI.file(path)`，跟 LSP 的 `file://` URI 一致。
- **開檔並跳行**：`store.openFile(...)` 後，隔兩個 animation frame 再 `setPendingEditorReveal({ filePath, fileId, line, column, matchLength })`（見 `components/terminal-pane/terminal-file-open-routing.ts`）。
- **本機判斷**：`components/debug/debug-launch.ts` 的 `isLocalDebugTarget`（repo 主機是 local、runtime 是 local、不是 WSL UNC 路徑）。資料夾工作區用 `getResolvedExecutionHostIdForWorktree` + `connectionId`。
- **下載安裝**：`main/debug/adapters/adapter-installer.ts`（`ensureDebugAdapterInstalled`：下載、SHA-256、staging 解壓、`.orca-installed` 標記）、`adapter-download.ts`（electron net，走系統 proxy）、`archive-extract.ts`（bsdtar，zip／tgz 都能解）。
- **LSP 的訊息格式跟 DAP 相同**（`Content-Length` + JSON），`main/debug/dap-framing.ts` 與 `dap-transport-stdio.ts` 直接沿用。
- **檔案變更**：編輯器開著檔案的工作區，renderer 已經透過 `window.api.fs.watchWorktree` 收到 `onFsChanged`，轉給 LSP 的 `workspace/didChangeWatchedFiles` 即可，不另外開 watcher。

### 4.1 Monaco 的行為（0.55，看過原始碼）

- 定義／參照會**問所有 provider 再合併**（`goToSymbol.js`），`ReferencesModel` 只去掉 URI 與範圍完全相同的項目。內建 TS worker 對 import 的符號會回傳 import 那一行，跟 LSP 的結果並存會很亂 → 對 `typescript`／`javascript` 關掉內建的 `definitions`／`references`（`setModeConfiguration`），改由 Orca 的 provider 分派：本機工作區走 LSP，其他（SSH、WSL、runtime、工作區外）改呼叫內建 TS worker，只保留同檔案內的結果。
- peek 視窗預覽別的檔案時用 `ITextModelService.createModelReference`，standalone 版**只找得到已存在的 model**，否則顯示失敗 → 對沒有開成分頁的目標檔，建立 `orca-lsp-preview:` scheme 的唯讀預覽 model（內容由 main 回傳），不碰 `file://` model，不干擾分頁的 model 生命週期；閒置（沒掛在編輯器上）的預覽 model 定期清掉。
- `registerEditorOpener` 的 opener 會先於 Monaco 預設的處理執行；目標是同一個 model 時回傳 `false`，讓 Monaco 自己在原編輯器裡定位。

## 5. 設計

### 5.1 main process（`main/code-navigation/`）

| 檔案 | 內容 |
|---|---|
| `language-server-manifest.ts` | 釘住版本與雜湊的下載清單 |
| `language-server-launch.ts` | 依種類準備啟動參數：TS → `<install>/package/lib/tsc --lsp --stdio`；C# → 找 `dotnet`，`dotnet <install>/tools/net10.0/any/CSharpLanguageServer.dll` |
| `lsp-connection.ts` | JSON-RPC：request／notify、`$/cancelRequest`、回應伺服器發來的 request（`workspace/configuration` 回 null、`client/registerCapability`、`window/workDoneProgress/create`） |
| `language-server-session.ts` | 一個 (工作區根目錄, 語言) 一個伺服器：initialize、文件同步（didOpen／didChange 全文／didClose）、檔案變更、查詢、閒置 15 分鐘關閉 |
| `code-navigation-service.ts` | session 表、懶啟動、狀態事件、把位置結果轉成路徑並附上預覽內容 |
| `code-navigation-ipc.ts` | IPC handler（zod 驗證） |

**文件同步策略**：不是每打一個字就送。renderer 在每次查詢時附上目前這份文件的內容與 Monaco 的 versionId；main 記錄每份文件最後送出的 versionId，不同才送 `didChange`（全文）。model 被 dispose 時 renderer 通知 `didClose`。伺服器的版本號由 main 自己遞增，不直接用 Monaco 的（model 重建後 versionId 會歸零）。

**啟動時機**：第一次在某工作區按跳轉時才啟動（第一次也會下載）。啟動中、下載中透過 `codeNav:status` 事件讓 renderer 顯示 toast。

**資源上限**：閒置 30 分鐘的伺服器會被關掉；同時最多 5 個（每個 worktree 各一個，使用者常開很多 worktree），超過時關掉最久沒用的。下次查詢會自動重新啟動。

**預覽內容**：查詢結果裡每個不同的目標檔（排除發出查詢的檔案本身）由 main 讀出內容一起回傳，上限 100 個檔、每檔 1 MB。

### 5.2 IPC

| channel | 方向 | 內容 |
|---|---|---|
| `codeNav:query` | invoke | `{ kind, root, feature: 'definition'｜'references'｜'implementation', document: { path, languageId, version, text }, position }` → `{ ok: true, locations: [{ path, range }], previews: { [path]: text } }` 或 `{ ok: false, message }` |
| `codeNav:closeDocument` | invoke | `{ kind, root, path }` |
| `codeNav:filesChanged` | invoke | `{ root, events: FsChangeEvent[] }`（只轉給該根目錄已啟動的 session） |
| `codeNav:status` | main → renderer | `{ kind, root, phase: 'downloading'｜'starting'｜'ready'｜'failed', message? }` |

### 5.3 renderer（`renderer/src/lib/code-navigation/`）

| 檔案 | 內容 |
|---|---|
| `code-navigation-languages.ts` | 副檔名 → 伺服器種類與 LSP languageId（`.ts .mts .cts .tsx .js .mjs .cjs .jsx` → typescript；`.cs` → csharp） |
| `code-navigation-workspace.ts` | 由 model URI 找出開著它的分頁 → 工作區 → 本機根目錄（非本機回傳 null） |
| `code-navigation-providers.ts` | 定義／參照／實作 provider，分派到 LSP 或內建 TS worker |
| `code-navigation-preview-models.ts` | `orca-lsp-preview:` 預覽 model 的建立、更新、清理 |
| `code-navigation-editor-opener.ts` | `registerEditorOpener`：URI → 開分頁 + 定位 |
| `code-navigation-document-lifecycle.ts` | model dispose → `closeDocument`；`onFsChanged` → `filesChanged` |
| `code-navigation-status-toasts.ts` | 顯示下載／啟動／失敗 toast |
| `install-code-navigation.ts` | 以上全部的掛載入口 |

upstream 檔案的掛載點：`monaco-setup.ts`（`runMonacoSetupSteps` 加一步）、`register-core-handlers.ts`（註冊 IPC）、`preload/index.ts` 與 `api-types.ts`（`codeNavigation` API）。

## 6. 已知限制（Phase 1）

- 只支援本機工作區（含資料夾工作區）；SSH、WSL、遠端 runtime 仍只有同檔案內的跳轉
- 跳到 .NET 框架型別（沒有原始碼的 metadata）會找不到定義，Phase 2 再做反編譯
- C# 的方案檔要在工作區根目錄（或讓 csharp-ls 自己掃 `.csproj`）；多個方案檔時由 csharp-ls 決定
- 未存檔的修改：只有發出查詢的那個檔案會帶最新內容給伺服器，其他分頁的未存檔修改在下次從它們發出查詢前伺服器看不到

## 7. 驗證方式

- 單元測試：LSP 連線（假 transport）、session 文件同步、manifest／平台對應、結果轉換、工作區解析、預覽 model 清理、opener 的 URI 對應
- 整合測試（真的伺服器，需要網路下載，預設跳過）：TS 跳到定義與參照；C# 跨專案跳到定義
- dev 實機：`ORCA_BACKGROUND_LAUNCH=1` 啟動，CDP 截圖確認 peek 視窗與開分頁

## 8. Phase 1 紀錄（2026-09-30）

- 程式：`main/code-navigation/`（manifest、launch、LSP 連線、session、service、IPC）、`preload/api/code-navigation-*`、`renderer/src/lib/code-navigation/`、`shared/code-navigation/`。upstream 掛載點：`monaco-setup.ts`、`register-core-handlers.ts`、`preload/index.ts`、`api-types.ts`，以及 fork 檔 `adapter-installer.ts` 多匯出兩個安裝目錄的 helper。
- i18n：`codeNavigation.*`（en、zh，zh-TW 由產生器產生）。
- 單元測試：main 6 檔、renderer 6 檔。
- 整合測試（`language-server-session.integration.test.ts`，設 `ORCA_TEST_TSC_NATIVE`、`ORCA_TEST_CSHARP_LS_DLL` 才跑）：TS 跨檔定義與參照、C# 跨專案定義，兩者都過。
- e2e（`tests/e2e/code-navigation.spec.ts`，設 `ORCA_E2E_CODE_NAVIGATION=1` 才跑，會真的下載伺服器；`ORCA_E2E_CODE_NAVIGATION_SCREENSHOTS=<目錄>` 可存截圖）：
  - TS：F12 開 greeter.ts 分頁並停在定義；Shift+F12 的 peek 顯示「References (4)」分兩個檔案；Cmd/Ctrl+點擊跳到定義
  - C#：F12 從 App 專案跳進 Lib 專案的介面；Cmd/Ctrl+F12 跳到實作類別。含下載 csharp-ls 與載入方案，整個測試約 22 秒
- 品質閘門（`check-changed-code-quality.mjs`）：新程式零問題；剩下的是既有的 fork 問題（`ProjectRunContextMenuItems.tsx`、IME 測試的型別斷言）。

### Phase 2 的起點

- 懸停提示：LSP `textDocument/hover` 接 Monaco `registerHoverProvider`；內建 TS worker 的 hover 要跟定義一樣改成分派
- C# 反編譯：csharp-ls 的 `csharp/metadata` 請求，回傳的原始碼用唯讀預覽 model（`orca-lsp-preview:` 之外另開一個 scheme）開啟
- 符號大綱：可考慮讓現有的「Structure」面板在有 LSP 時改用 `textDocument/documentSymbol`
