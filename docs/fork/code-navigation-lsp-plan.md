# 編輯器程式碼跳轉（LSP）：實作計畫（fork 專屬）

> 狀態：Phase 1 完成（2026-09-30，§8）；Phase 2 完成（2026-09-30，§9）；JetBrains 快捷鍵（§10）；C# 速度（§11）；MediatR（§12）；Razor 與 ASP.NET MVC（2026-10-01，§13）；Vue／Nuxt 規劃中（[`code-navigation-vue-nuxt-plan.md`](./code-navigation-vue-nuxt-plan.md)）；Phase 3 未開始
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
- ~~跳到 .NET 框架型別會找不到定義~~：Phase 2 已改為開啟反編譯的原始碼（§9.3）
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

## 9. Phase 2：懸停提示、跳到型別定義、C# 反編譯（2026-09-30）

### 9.1 範圍的決定

| 項目 | 結果 |
|---|---|
| 懸停提示 | 做。TS/JS/C# 都改走 LSP |
| 跳到型別定義 | 順便做。跟定義同一條路，只多一個 `textDocument/typeDefinition` |
| C# 反編譯 | 做。F12 到 `Console`、`List<T>` 這類框架型別會開反編譯的原始碼 |
| 符號大綱 | **不做**。Structure 面板已經用 TS worker 的 navigation tree（TS/JS）和 tree-sitter（C# 等）產生大綱，e2e 截圖裡 C# 的大綱也正確；換成 LSP 只多一個要啟動的伺服器，沒有明顯好處 |

TS 的內建型別（`console`、`Array`）不需要處理：TypeScript 7 回傳的是安裝目錄裡的 `lib.*.d.ts` 實體檔，第 1 階段就能開。

### 9.2 懸停提示

- renderer 對 typescript、javascript、csharp 註冊 hover provider，並把內建 TS 的 `hovers` 也關掉（同樣是因為 Monaco 會把所有 provider 的結果疊在一起；內建 worker 解析不到 import，會顯示 `any`）。
- **懸停不會觸發下載**：`codeNav:hover` 只會用正在跑的伺服器，或啟動「已經裝好」的伺服器（`isLanguageServerInstalled`，只檢查 `.orca-installed`）。沒裝就回 `ok: false`，renderer 退回 Monaco 內建的 TS hover（`code-navigation-ts-worker-fallback.ts`，照 Monaco 原本的格式重寫）。從 hover 啟動的伺服器不顯示 toast。
- initialize 時宣告 `hover.contentFormat: ['markdown', 'plaintext']`；沒宣告的話 TypeScript 7 回傳純文字。純文字與 `{ language, value }` 形式都轉成程式碼區塊（`lsp-hover.ts`）。

### 9.3 C# 反編譯

- csharp-ls 預設 `useMetadataUris = false`，這時對框架型別的定義是空的。`LanguageServerLaunch.configuration` 在 `workspace/configuration` 的 `csharp` 區段回 `{ useMetadataUris: true }` 後，定義會回傳 `csharp:/<csproj>/decompiled/System.Console.cs`，再用 `csharp/metadata` 請求拿到原始碼。
- Orca 的分頁以檔案為單位，所以把原始碼寫到 `userData/language-servers/csharp-metadata/<assembly>-<URI 雜湊>/<symbol>.cs`，**唯讀**（0o444）。內容沒變就不重寫，避免開著的分頁跳出「檔案已變更」。雜湊是為了區分不同專案參照的同名但不同版本組件。
- 位置解析拆到 `navigation-target-files.ts`：`file:` 直接用、`csharp:` 經由上述檔案、其他 scheme 丟掉；同一個 `csharp:` URI 在一次查詢裡只解析一次。
- 反編譯檔在工作區外，所以在裡面再按 F12 不會有作用（沿用第 1 階段「只處理工作區內的檔案」的規則）。

### 9.4 驗證

- 單元測試：`lsp-hover`、`csharp-metadata-files`、service 的反編譯與 hover（含「未安裝時 hover 不啟動伺服器」）、session 的 hover 與 `workspace/configuration`、renderer 的 hover 分派與 TS worker 後備。
- 整合測試（真的伺服器）：TS hover 顯示跨檔解析的簽名；C# 跳進反編譯的 `System.Console`（寫出的檔案含 `public static class Console`）；C# hover。
- e2e：見 §9.5。

### 9.5 紀錄

- 新檔：`main/code-navigation/lsp-hover.ts`、`csharp-metadata-files.ts`、`navigation-target-files.ts`、`renderer/src/lib/code-navigation/code-navigation-ts-worker-fallback.ts`；IPC 多一個 `codeNav:hover`，preload 多一個 `hover`。沒有新的 UI 字串，也沒有動到新的 upstream 檔案。
- 另設 `ORCA_TEST_NETCOREAPP31=1`（需要 3.1 的 reference pack）會多跑一個 netcoreapp3.1 專案：`@model` 型別與 `Model.Total` 都要跳得到；拿掉注入的 targets 就會失敗。
- e2e（`ORCA_E2E_CODE_NAVIGATION=1`）兩項都過：
  - TS：原本的 F12／Cmd+點擊／peek，加上懸停在 `greet` 上顯示 `function greet(name: string): string`（從 import 解析出的真實簽名）
  - C#：原本的跨專案 F12 與跳到實作，加上懸停 `IGreeter`，以及 F12 到 `Console` 開啟 `System.Console.cs`（停在第 10 行 `public static class Console`，Structure 面板也列出成員）
- 反編譯檔累積在 `csharp-metadata/`，目前不清理（都是小的文字檔）。

## 10. JetBrains 快捷鍵與 Back／Forward（2026-09-30）

### 10.1 使用者的決定

- ⌘B（Ctrl+B）在**程式碼編輯器聚焦時**跳到宣告；其他地方仍是「切換左側欄」
- 要做 ⌘[／⌘] 的 Back／Forward（跨分頁的跳轉歷史），在編輯器裡蓋掉 Monaco 的減少／增加縮排

同一個原則（「編輯器聚焦時 JetBrains 的鍵優先」）也套用到：⇧⌘B（原本是「新增瀏覽器分頁」）、Windows/Linux 的 Ctrl+Alt+←／→（原本是工作區歷史）。

### 10.2 鍵位（`shared/keybindings/definitions-code-navigation.ts`，scope `editor`，設定頁可改）

| 動作 | macOS | Windows／Linux | 執行的 Monaco 動作 |
|---|---|---|---|
| Go to Declaration | ⌘B | Ctrl+B | `editor.action.revealDefinition` |
| Go to Implementation | ⌥⌘B、⌥⌘+點擊 | Ctrl+Alt+B、Ctrl+Alt+點擊 | `editor.action.goToImplementation` |
| Go to Type Declaration | ⇧⌘B | Ctrl+Shift+B | `editor.action.goToTypeDefinition` |
| Find Usages | ⌥F7 | Alt+F7 | `editor.action.goToReferences`（peek） |
| Quick Documentation | F1 | （無，Ctrl+Q 是原生的結束） | `editor.action.showHover` |
| Navigate Back／Forward | ⌘[／⌘] | Ctrl+Alt+←／→ | Orca 自己的歷史 |

F12、⇧F12、⌘F12、⌘+點擊這些 Monaco 原本的鍵都保留。衝突偵測是按 `conflictGroup ?? scope` 分組，editor scope 的鍵不會被判定與 global／tabs 的同鍵衝突（`keybindings-conflicts.test.ts` 仍要求預設零衝突）。

注意：dev 模式下 main 會攔截 F12 開關 DevTools，所以 dev 版只能用 ⌘B／⌘+點擊。

### 10.3 按鍵怎麼送到編輯器

- ⌘B、Ctrl+Alt+← 這類鍵在 main 的 `before-input-event` 就被攔截成 app 動作，renderer 收不到。比照 Markdown 編輯器 ⌘B 粗體的做法：renderer 在「編輯器分頁」的 Monaco 取得／失去文字焦點時送 `codeNav:setCodeEditorFocused`，main（`code-editor-shortcut-ownership.ts`，依 webContents id 記錄）在 `main-window-shortcut-routing.ts` 解析 app 動作之前，若這個鍵符合上表任一動作就放行。
- renderer 端 `code-navigation-keymap.ts` 在 window 的 capture 階段接手（早於 Monaco 自己的 keybinding，才能蓋過 ⌘[ 縮排），只在焦點是編輯器分頁時作用；diff、SQL console 等其他 Monaco 不受影響。

### 10.4 Back／Forward 歷史（`code-navigation-history.ts`）

- 每個工作區一份，最多 50 筆。
- 記錄點：(1) 每次跳轉前的位置——所有跳轉（F12、⌘B、⌘+點擊、peek 開啟，連同檔內跳轉）都會先經過 `registerEditorOpener` 的 opener，同檔跳轉只是之後回傳 false 交給 Monaco；(2) 游標落到另一個檔案（從檔案樹、搜尋開檔等）時，離開的那個位置。
- Back／Forward 自己開啟的分頁回報位置時不算「移動」（`pendingArrival`），同一位置不重複記錄。

### 10.5 ⌥⌘+點擊跳到實作（`code-navigation-implementation-click.ts`）

- 使用者問「跳到實作怎麼用滑鼠觸發」後補上，照 JetBrains：macOS ⌥⌘+點擊、其他平台 Ctrl+Alt+點擊。滑鼠手勢不在 Orca 的快捷鍵系統裡，所以不能在設定頁改。
- 掛在每個編輯器的 container（`getContainerDomNode`，建立時就存在；view 的節點每換一次 model 就重建）的 capture 階段，早於 Monaco 的 pointer 處理。Monaco 原本把 ⌥⌘+點擊當成「在側邊開定義」，而且它的 link gesture 在 pointerup 觸發、`_hasTriggerKeyOnMouseDown` 會殘留，所以認領後要把 pointerdown／pointerup 連同之後 500ms 內的相容 mouse 事件都吞掉。
- e2e：C# 在 `IGreeter` 上 ⌥⌘+點擊跳到 Greeter.cs 第 8 行的實作類別（跳到定義會停在第 3 行的介面）。

### 10.6 巢狀專案（家目錄也是一個專案）的修正

使用者回報：F12 到 MediatR 的 `ISender`（反編譯檔）時，Orca 跳到另一個專案，⌘[ 也回不去。

- 原因：使用者把家目錄 `/Users/omar` 加成了一個專案，底下還有 `Autron/ecommerce_project` 等專案。同一個檔案在兩個專案各開一個分頁時，它們共用同一個 Monaco model（model 只看路徑），`findEditTabForModelUri` 取第一個符合的分頁，剛好是家目錄那個，於是跳轉目標開在家目錄專案、Orca 切了過去，而歷史是分專案記的。
- 修正一：`findEditTabForModelUri` 在多個分頁都符合時，優先取使用中的檔案（`activeFileId`），其次是使用中專案（`activeWorktreeId`）的分頁。
- 修正二：語言伺服器的根目錄改取「包含這個檔案的最內層本機專案」（`innermostLocalRoot`），家目錄專案裡的 `ecommerce_project` 檔案會以 `ecommerce_project` 為根，不會對整個家目錄啟動 csharp-ls。
- 修正三：反編譯檔（`language-servers/csharp-metadata/` 底下，`isCodeNavigationMetadataPath`）一律不送給語言伺服器。它在家目錄底下，不排除的話，在家目錄專案裡懸停就會以整個家目錄為根啟動 csharp-ls（使用者的快取裡有兩份不同雜湊的 MediatR，就是從兩個不同的根解析出來的）。
- e2e：C# 從反編譯的 `System.Console.cs` 按 Back 回到 Program.cs 原位置。巢狀專案的情境由 `code-navigation-workspace.test.ts` 覆蓋。

### 10.7 真正的根本原因：外部檔案被遷移到「包含它的專案」

§10.6 的修正之後，使用者再試出現「無法載入檔案：The sibling file is already open」。追下去才找到主因：

- Orca 的分頁以絕對路徑開啟工作區外的檔案時，`useEditorPanelFileContentLoader` 在載入前會用 `findWorkspaceFileRoute` 找「路徑上包含這個檔案的專案」，找到就用 `migrateRestoredEditorFileOwner` 把分頁搬過去（upstream 行為）。反編譯檔與 TS 內建型別都在 `~/Library/Application Support/orca*/language-servers/` 底下，被家目錄專案包含，於是分頁被搬走、Orca 切換專案、Back 失效。§10.6 描述的「同一檔案兩個分頁」是另一個真實但次要的問題。
- 這次的錯誤是：上一次搬過去的舊分頁還在家目錄專案裡，新分頁再搬就撞到它（`collision`）。
- 修正：`OpenFile.staysInOpeningWorkspace`。跳轉開啟工作區外的檔案時設為 true，載入時不做遷移，分頁留在發起跳轉的專案。這個欄位跟 `readOnly` 一樣持久化（schema、`PersistedOpenFile`、`buildEditorSessionData`、`hydrateEditorSession` 各加一行），重啟後還原的分頁也不會被搬走。反編譯檔另外標 `readOnly`。
- e2e：建立一個資料夾工作區，路徑就是 Orca 的 userData（等同家目錄專案包住伺服器檔案），在 TS 專案對 `console` 按 F12 開 `lib.dom.d.ts`，確認專案沒被切換、Back 回到 app.ts。拿掉修正時這個 e2e 會失敗（分頁被搬走）。注意 macOS 的 `/var` 與 `/private/var`：伺服器回報實體路徑，測試要 `realpath`。
- 補強（使用者再次看到同一個錯誤：修正前留下的舊分頁在重啟後被還原，沒有標記）：
  - 載入端直接認得 Orca 語言伺服器的檔案（`isOrcaLanguageServerFilePath`：`language-servers/csharp-metadata/`、`language-servers/typescript-native/`），它們不屬於任何專案，一律不遷移。舊分頁按「重試」或重啟後就能載入，不必手動清理。
  - 跳轉到一個已經開著、但缺標記的分頁時（`openFile` 對既有分頁不會更新這些旗標），補上 `staysInOpeningWorkspace`／`readOnly` 並遞增 `fileContentReloadNonce` 重新載入一次（有未存修改的分頁不會被重新載入）。

## 11. C# 第一次跳轉的速度（2026-10-01）

使用者問「為什麼 loading 要這麼久」。在使用者的 `ecommerce_project`（2 個 csproj、EcommerceApi 1215 個 .cs）實測 csharp-ls：

| 階段 | x86_64 .NET（經 Rosetta，使用者現況） | arm64 原生 .NET 10 |
|---|---|---|
| 啟動 | 0.9 秒 | 0.2 秒 |
| csharp-ls 在資料夾裡找方案檔 | 2 秒 | 2 秒 |
| MSBuild 載入方案 | 3.8 秒 | 1.4 秒 |
| 第一次語意編譯 | 8.1 秒 | 3.2 秒 |
| 第一次跳轉總計 | 14.8 秒 | 6.8 秒 |

之後的跳轉都在 0.5 秒內。log 裡的「MSBuild failed」只是 NuGet 的 NU1510 警告（`System.Text.Encoding.CodePages` 可移除），不影響載入。

使用者選的改善（arm64 dotnet 暫不做，要使用者另外安裝）：
- **自動指定方案檔**（`csharp-solution-discovery.ts`）：Orca 以廣度優先找根目錄下最淺層的 `.sln`／`.slnx`（最多 4 層、2000 個資料夾，略過 node_modules、bin、obj、隱藏資料夾等），該層只有一個時用 `--solution <相對路徑>` 交給 csharp-ls。實測省下約 2 秒。
- **背景預熱**（`code-navigation-prewarm.ts` + `codeNav:warm`）：C# 檔的編輯器換上 model 或取得焦點時，在背景啟動「已安裝」的伺服器，並在檔案開頭發一次 hover 逼它載入並編譯（實測預熱後第一次跳轉從 12.3 秒降到 0.4 秒）。同一個專案 60 秒內最多一次，也順便讓持續工作中的專案不被閒置關閉。TS 不預熱（本來就約 1 秒）。
- 預熱還沒完成就按跳轉時，那次查詢也會顯示「正在載入」的提示（`joinsStartingServer`）。

## 12. MediatR：從 request 直接跳到 handler（2026-10-01）

使用者問「mediator 的部分有快速到 handler 的方式嗎」。原本只能在 request 類型上 ⌥F7 找使用處，再從清單裡找 `IRequestHandler<…>` 那一行。

- 在 C# 的「跳到實作」（⌥⌘B、⌥⌘+點擊、⌘F12）上加 MediatR 判斷（`csharp-mediatr-handlers.ts`）：一般實作結果只有型別本身（request 是具體類別／record）或是空的時，改找 handler。
- 游標在 `new ListPublishedArticlesQuery(…)` 裡時，Roslyn 認定的符號是建構式，它的參照不含 handler。所以先用 `definition` 找到型別宣告，再從宣告處查 `references`（實測：從建構式查只有 4 筆使用處；從型別宣告查會多出 `: IRequestHandler<…>` 與 `Handle(…)` 兩筆）。
- 參照的前文符合 `I(Request|Notification|StreamRequest)Handler<` 的就是 handler；目標是同一個 handler 裡、前文符合 `Handle(` 的那個參照所在的 `Handle` 方法名稱（找不到就停在 base list）。通知有多個 handler 時交給 peek 清單。
- 真實驗證：使用者的 `ecommerce_project`，`ListPublishedArticlesQuery`、`GetPublishedArticleBySlugQuery` 都落在各自 handler 的 `Handle` 方法（熱的時候 57ms）。
- e2e：C# 範例加入 MediatR 形狀的介面（不需要 NuGet），`new GetGreeting("world")` 上 ⌥⌘B 落在 `GetGreetingHandler.Handle`。

## 13. Razor（.cshtml）與 ASP.NET MVC 對應（2026-10-01）

使用者問 `.cshtml` 有沒有支援，選了「C# 部分 + MVC 對應跳轉」。

### 13.1 .cshtml 裡的 C#（交給 csharp-ls）

- csharp-ls 0.28 有實驗性的 Razor 支援：啟動加 `--features razor-support`，`.cshtml` 以 languageId `razor` 開啟。它用 Razor 原始碼產生器產出的 C# 對應位置，`@model` 型別、`Model.X`、`@{ }`／`@if` 區塊裡的 C# 都能跳到定義、找參照、懸停。
- **BOM 陷阱**（實測）：傳給伺服器的文字若以 BOM 字元開頭，Razor 解析器認不出第一行的 `@model`，整個 view 什麼都查不到。Visual Studio 與 `dotnet new` 存的 view 都帶 BOM。Monaco 載入時已去掉 BOM，session 送出前仍一律去掉（`syncDocument`）。
- 一開始以為 `.cshtml` 請求不等方案載入，後來證實空結果都是 BOM 造成的；`.cshtml` 請求一樣會等載入，沿用 §11 的預載即可。
- **舊版 TFM**（使用者的 new-taipei（netcoreapp2.2）與 sisisusu（netcoreapp3.1）實測）：伺服器只看得到 Razor 產生器產出的 C#，而 SDK 只對 net6.0 以上預設啟用產生器，舊專案的 view 全部查無結果。
  - 2.x：設環境變數 `UseRazorSourceGenerator=true` 即可（SDK 對 2.x 不寫死這個值）。
  - 3.x／5.0：SDK 的 `Sdk.Razor.CurrentVersion.targets` 無條件設成 `false`，環境變數蓋不掉，csharp-ls 也沒有傳 MSBuild 全域屬性的選項。改由 Orca 寫一份 `language-servers/csharp-razor-design-time.targets`，用環境變數 `CustomAfterMicrosoftCommonTargets` 掛進 design-time build：只對 3.0 ≤ TFM < 6.0 匯入 SDK 自己的 `Microsoft.NET.Sdk.Razor.SourceGenerators.targets`，並在執行期把 `ResolveTagHelperRazorGenerateInputs` 從 `PrepareForRazorGenerateDependsOn` 拿掉（它會先編譯專案，與在編譯中執行的產生器形成循環相依）。使用者環境已設 `CustomAfterMicrosoftCommonTargets` 時不覆蓋。
  - `textDocument/references` 不帶 `context` 時 csharp-ls 會丟 NullReferenceException；Orca 一律帶 `includeDeclaration`，只有手寫測試腳本會踩到。
- 伺服器只處理 Razor 裡的 C#：tag helper 屬性值、partial 名稱等字串交給 §13.2。Blazor 的 `.razor` 不支援（csharp-ls 只認 `.cshtml`）。
- 用 `dotnet new mvc` 的專案與 csharp-ls 自己的測試專案都驗證過；SDK 10.0.201（x64）與 10.0.401（arm64）結果相同。

### 13.2 MVC 對應（Orca 自己實作，`aspnet-mvc-constructs.ts`、`aspnet-mvc-targets.ts`）

C# 的「跳到定義」在送給伺服器之前，先判斷游標是不是下列寫法；命中且找得到目標就直接回傳（`View()` 本來會跳到反編譯的 `Controller.View`），否則照常走 LSP。

| 位置 | 寫法 | 目標 |
|---|---|---|
| view | `asp-action="X"`（同一個 tag 的 `asp-controller`，沒有就用 view 所在的 `Views/{Controller}`） | controller 的 action（多載全列，peek） |
| view | `asp-controller="X"` | controller 類別 |
| view | `<partial name="X">`、`Html.Partial/PartialAsync/RenderPartial/RenderPartialAsync("X")`、`Layout = "X"` | view 檔 |
| 兩者 | `Html.ActionLink(文字, action, controller)`、`Url.Action(action, controller)`、`Html.BeginForm(action, controller)`、`RedirectToAction(action, controller)` | action 或 controller |
| controller | `View()`、`PartialView()`（沒寫名稱時取所在 action 的名稱，`[ActionName("X")]` 優先） | view 檔 |
| controller | `View("X")`、`PartialView("X")` | view 檔 |

- **找 view**：照 ASP.NET 的搜尋順序：view 自己的資料夾（partial 放在旁邊；也涵蓋 feature folders）→ `Areas/{A}/Views/{C}` → `Areas/{A}/Views/Shared` → `Views/{C}` → `Views/Shared` →（partial／layout）`Pages/Shared`。`~/` 開頭是專案相對路徑，含 `/` 是相對目前 view。專案目錄是往上找到的第一個 `.csproj` 所在資料夾。
- **找 controller／action**：`workspace/symbol`（會等方案載入）。class 以名稱完全相符（kind 5）；action 比對 csharp-ls 的方法名稱格式 `IActionResult HomeController.Index(int id)`（kind 6）。有指定 area 時優先 `Areas/{A}/` 底下的結果；找不到 action（繼承或改名）就跳到 controller 類別。
- **字串辨識**：取游標兩側最近的一對引號，而且左引號前面必須是 `(`、`,`、`=` 或 `:`，才能處理 `href="@Url.Action("Details")"` 這種 HTML 屬性裡再包 C# 字串的寫法，也不會把兩個字串中間的片段誤認為字串。往回找呼叫時會跳過前面字串參數裡的逗號。

### 13.3 驗證

- 單元測試：`aspnet-mvc-constructs.test.ts`（各種寫法、巢狀引號、`[ActionName]`、不該命中的情況）、`aspnet-mvc-targets.test.ts`（搜尋順序、area、多載、fallback）、session 的 BOM 測試。
- 整合測試 `aspnet-mvc.integration.test.ts`（設 `ORCA_TEST_CSHARP_LS_DLL` 才跑）：`dotnet new mvc` 加上 Orders controller 與 view，asp-action／asp-controller／partial／`Model.RequestId`／`View()`／`View("Show")`／`[ActionName]`／`RedirectToAction` 全部命中。
- e2e（`ORCA_E2E_CODE_NAVIGATION=1`）：view 裡 ⌘B 在 `asp-action="Privacy"` 開到 `HomeController.cs` 的 `Privacy`、⌘[ 回來；`@Model.RequestId` 到 `ErrorViewModel.cs`；controller 裡 `return View()` 到 `Views/Orders/Index.cshtml`。

