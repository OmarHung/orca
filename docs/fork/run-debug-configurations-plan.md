# Run / Debug 設定與內建除錯器：實作計畫（fork 專屬）

> 狀態：Phase 0～4 已完成（2026-09-26）：Python、Node／TS、.NET 除錯，Run／Stop／Rerun，專案偵測，右鍵選單，Python interpreter，以及完整的 Debug UI（條件中斷點、logpoint、例外中斷、Watch、REPL、hover、inline values）。Phase 5（Edit Configurations、beforeLaunch、compound、launch.json 匯入、orca.yaml 共享設定）也已完成並合併
> 分支：從 `omar/custom` 開 `feat/run-debug`，完成後合回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 目標

在 Orca 裡做出接近 JetBrains（Rider／PyCharm／WebStorm）的 Run／Debug 體驗，優先支援 **.NET、Python、Node／TS**：

1. **右上角 Run widget**：設定下拉選單 + ▶ Run、🐞 Debug、■ Stop、↻ Rerun、⋮ 更多操作，以及 `Edit Configurations…`
2. **檔案樹右鍵**：在專案資料夾或專案檔上按右鍵，可以 Build／Run／Debug／Publish，也有 `More Run/Debug` 子選單
3. **自動偵測專案**，產生建議的執行設定
4. **Orca 內建除錯器**：可以在 Monaco 編輯器下中斷點，暫停時看得到 Call Stack、Variables、Watch、Debug Console，也能逐步執行

## 2. 已確定的決策

| # | 決策 | 內容 |
|---|---|---|
| D1 | 範圍 | **先把本機做完整**。WSL 和 SSH 遠端除錯不在這一輪（見 §9） |
| D2 | Adapter 取得 | **第一次使用時自動下載**，用 SHA-256 驗證，不打包進安裝檔 |
| D3 | 開工順序 | **先做 Python 除錯原型**（Phase 0），確認體驗之後再做 Run 設定和其他語言 |
| D4 | 資料模型 | 執行設定是**現有 Quick Commands 的擴充**，不另外做一套系統 |
| D5 | 授權 | 只用 MIT、BSD、Apache 授權的元件。**不能用** vsdbg（授權只允許用在 VS／VS Code）；**不能複製** Theia（EPL／GPL）、Zed、nvim-dap 的程式碼，只能參考設計 |
| D6 | 降低 upstream 衝突 | 新程式碼放在新目錄（`src/main/debug/`、`src/renderer/src/components/debug/`、`src/shared/run-configurations/`）；對 upstream 檔案只加最小的掛載點 |

## 3. 開源元件

### 3.1 Debug adapter（DAP server）

| 語言 | 套件 | 授權 | 啟動方式 | 注意事項 |
|---|---|---|---|---|
| .NET | [Samsung/netcoredbg](https://github.com/Samsung/netcoredbg) | MIT | `netcoredbg --interpreter=vscode`（stdio） | 3.2.x 有 linux-amd64、linux-arm64、osx-arm64（官方標示社群支援）、win64。**Intel Mac 只能用 3.1.3**；**Windows arm64 沒有版本**。不支援 Hot Reload 和 Edit-and-Continue |
| Python | [microsoft/debugpy](https://github.com/microsoft/debugpy) | MIT | `python -m debugpy.adapter`（stdio） | 從 PyPI 下載純 Python 的 wheel（`py2.py3-none-any`），放進 `PYTHONPATH` 使用，**不安裝到使用者的虛擬環境** |
| Node／TS | [microsoft/vscode-js-debug](https://github.com/microsoft/vscode-js-debug) | MIT | 下載 release 的 `js-debug-dap-v*.tar.gz`，執行 `node js-debug/src/dapDebugServer.js <port>`（**只支援 TCP**） | 本機用 Electron 內建的 Node（`ELECTRON_RUN_AS_NODE=1`）執行。會用 `startDebugging` reverse request 開子 session，client 一定要支援（Helix 就是因為沒支援才壞掉） |

下載網址可以參考 [mason-registry](https://github.com/mason-org/mason-registry)（Apache-2.0）裡的 `netcoredbg`、`debugpy`、`js-debug-adapter` 套件定義，但**版本和 SHA-256 由我們自己的 manifest 鎖定**。GitHub release 的壓縮檔沒有簽章，所以 hash 必須在實作時從真正下載的檔案算出來，不能憑空填。debugpy 的 hash 可以從 PyPI JSON API 取得。

### 3.2 函式庫

| 用途 | 選擇 | 授權 | 備註 |
|---|---|---|---|
| DAP 協定型別 | `@vscode/debugprotocol` | MIT | 只用型別 |
| DAP client 測試 | `@vscode/debugadapter-testsupport` | MIT | 只放在 devDependencies |
| DAP client 本體 | **自己寫** | – | `Content-Length` 分幀 + JSON、seq／response 配對、events、reverse requests。npm 上現有的 client 都是 0.x、只有一個人在維護 |
| `launch.json`、`launchSettings.json` | `jsonc-parser` | MIT | **已經是依賴** |
| `.csproj`、`.slnx`、`.pubxml` | `fast-xml-parser` | MIT | 新依賴。優先用 `dotnet msbuild -getProperty:X`（SDK 8.0.200 以上），XML 解析當 fallback |
| `pyproject.toml` | `smol-toml` | BSD-3 | 新依賴 |
| Node 套件管理器 | `package-manager-detector` | MIT | 新依賴 |
| 中斷點 gutter、目前行、行內變數值 | Monaco 內建 API | – | 不用 `monaco-breakpoints`（2024 年後就沒維護） |
| Debug 面板 | 自己用 shadcn 做 | – | 沒有可以單獨使用的 React DAP 元件。OpenSumi（MIT）的 `ide-debug` 可以參考 view-model 的設計 |

## 4. 現有程式碼的掛載點

| 需求 | 位置 | 說明 |
|---|---|---|
| 編輯器 | `src/renderer/src/components/editor/MonacoEditor.tsx:235-270` | 目前沒有開 `glyphMargin`，要加上 `glyphMargin: true` |
| Gutter 滑鼠事件 | `src/renderer/src/components/editor/use-monaco-editor-mount.ts:155-167` | 已經有攔截行號右鍵（`MonacoGutterContextMenu.tsx`），可以在同一個地方加 `GUTTER_GLYPH_MARGIN` 點擊 |
| Decoration 寫法範例 | `use-monaco-editor-decorations.ts:82`、`monaco-conflict-decorations.ts:52` | 用 `createDecorationsCollection` |
| 開檔並跳到指定行 | `openFile()`（`store/slices/editor/types/editor-files-slice.ts:37`）+ `scheduleEditorLineReveal()`（`store/slices/editor/focus/editor-focus-reveal.ts:42`） | 參考呼叫方式：`terminal-pane/terminal-file-open-routing.ts:270-295` |
| Bottom panel | `src/renderer/src/components/bottom-panel/BottomPanel.tsx`、`bottom-panel-layout-store.ts` | **目前寫死只有 Git Log**，要加上 `activeTab` 和 tab 切換 |
| 右上角標題列 | `src/renderer/src/app-shell/TitlebarMainStrip.tsx` | Run widget 放在 `#titlebar-tabs` 和 `RightSidebarToggle` 之間 |
| 檔案樹右鍵 | `src/renderer/src/components/right-sidebar/file-explorer-row-context-menu.tsx` | 加一段 Run／Debug 項目 |
| Quick Commands 型別 | `src/shared/terminal-quick-command-types.ts`、`src/shared/terminal-quick-commands.ts` | 擴充選填欄位 |
| Quick Commands 執行 | `src/renderer/src/lib/run-quick-command-in-new-tab.ts` | 加入「重用 tab」的邏輯 |
| 現有的 tab bar 按鈕 | `src/renderer/src/components/tab-bar/TabBarQuickCommandsMenu.tsx`、`TabBarQuickCommandsButton.tsx` | 先保留，Run widget 穩定之後再決定要不要移除 |
| 指令開始／結束事件 | `src/renderer/src/hooks/terminal-command-finished-event.ts`、`components/terminal-pane/terminal-command-lifecycle.ts`（OSC 133 C／D） | 事件目前只帶 `worktreeId`，**要加上 `tabId`** |
| 送 Ctrl‑C 或輸入 | `sendRuntimePtyInput`（`src/renderer/src/runtime/runtime-terminal-inspection.ts`） | 已經處理本機、SSH、remote runtime |
| 讀專案檔 | `readRuntimeFileContent()`（`src/renderer/src/runtime/runtime-file-read-client.ts:27`） | 本機、WSL、SSH 都可以用 |
| 快捷鍵 | `src/shared/keybindings/types.ts:49`（`KeybindingActionId`）、`definitions-core-*.ts`、`src/renderer/src/app-shell/app-command-handlers.ts` | 參考 `bottomPanel.gitLog.toggle` 的寫法 |
| 啟動子程序 | `src/shared/child-process/` 的 `spawnProcess` | **AGENTS.md 規定不能直接用 `child_process`**，有 ratchet 測試會擋 |

## 5. 架構

```
Renderer                              Main process                         本機
────────                              ────────────                         ────
Monaco 中斷點／目前行 ─┐           ┌─ DebugSessionManager ──────┐        ┌─ debugpy.adapter（stdio）
Debug Panel ──────────┼── IPC ────►│   DapClient（每個 session） │─ 傳輸 ─►├─ netcoredbg（stdio）
Run widget／右鍵選單 ──┘           │   AdapterManager（下載＋驗證）│        └─ js-debug（TCP，localhost）
                                   └────────────────────────────┘
```

### 5.1 Main process（`src/main/debug/`）

| 檔案 | 職責 |
|---|---|
| `dap-framing.ts` | `Content-Length` 分幀解析與編碼（純函式，好測試） |
| `dap-client.ts` | request／response 配對、逾時、events、reverse requests（`runInTerminal`、`startDebugging`） |
| `dap-transport-stdio.ts`、`dap-transport-tcp.ts` | 傳輸層介面與兩種實作 |
| `debug-session-manager.ts` | session 生命週期：`initialize` → `launch`／`attach` → `setBreakpoints` → `configurationDone`；子 session 樹；結束時清理程序 |
| `adapters/adapter-manifest.ts` | 各 adapter 各平台的 `{ version, url, sha256, entry }` |
| `adapters/adapter-installer.ts` | 下載到 `app.getPath('userData')/debug-adapters/<name>/<version>/`、驗證 SHA-256、解壓、原子性搬移（先放暫存目錄再 rename）、處理並行安裝 |
| `adapters/{debugpy,netcoredbg,js-debug}-adapter.ts` | 產生啟動參數，以及把 launch 設定轉成各 adapter 需要的格式 |
| `debug-ipc.ts` | IPC channel：`debug:start`、`debug:request`、`debug:stop`、`debug:event` |

`runInTerminal` reverse request 要開一個 Orca 終端機 tab 來跑被除錯的程式，這樣 stdin 和輸出都在 Orca 的終端機裡，跟 JetBrains 的 Run 視窗一樣。

### 5.2 Renderer

| 位置 | 職責 |
|---|---|
| `store/slices/debug/` | sessions、threads、stack frames、scopes、variables 快取、目前停住的位置；以 worktree + 檔案為單位保存中斷點 |
| `components/debug/DebugPanel.tsx` 和子元件 | 工具列、Call Stack、Variables（依 `variablesReference` 延遲載入的樹）、Watch、Console、Breakpoints |
| `components/editor/monaco-breakpoint-decorations.ts` | gutter 圓點、條件中斷點、目前行標示、行內變數值 |
| `components/editor/monaco-debug-hover.ts` | `HoverProvider` → DAP `evaluate`（`context: 'hover'`） |
| `components/run-widget/TitlebarRunWidget.tsx` | 右上角 Run widget |

### 5.3 執行設定（`src/shared/run-configurations/`）

在 `TerminalCommandQuickCommand` 加上選填欄位（沒填就等於現在的行為，舊設定不用 migration）：

```ts
kind?: 'build' | 'run' | 'test' | 'publish' | 'other'
cwd?: string
env?: Record<string, string>
singleInstance?: boolean
beforeLaunch?: string[]               // 其他設定的 id
debug?: {
  adapter: 'debugpy' | 'netcoredbg' | 'js-debug'
  launch: Record<string, unknown>     // 傳給 adapter 的 launch 參數，要先驗證
}
```

偵測器放在 `src/shared/run-configurations/detectors/`，每種語言一個檔案，輸入是「讀檔函式 + 目錄」，輸出是建議的設定。偵測到的設定**不會自動存檔**，使用者執行或編輯之後才存成正式設定（跟 JetBrains 的暫時設定一樣）。

| | .NET | Python | Node／TS |
|---|---|---|---|
| 偵測依據 | `.sln`／`.slnx`／`.csproj`，`Properties/launchSettings.json` 的每個 profile | `pyproject.toml`、`manage.py`、FastAPI／uvicorn、Flask、`[project.scripts]` | `package.json` 的 scripts、workspaces |
| Interpreter／Runtime | `dotnet` | 依序找 `.venv`、`uv`、`poetry env info -p`、`python3` | `package-manager-detector` |
| Build | `dotnet build` | `uv build`／`python -m build` | `scripts.build` |
| Run | `dotnet run --launch-profile X` | `manage.py runserver`、`uvicorn`、`python -m` | `<pm> run <script>` |
| Debug | 先 build，再用 netcoredbg launch 產出的 dll | debugpy launch（`module`／`program`） | js-debug `pwa-node`，用 `runtimeExecutable` 包住套件管理器 |
| Publish | `Properties/PublishProfiles/*.pubxml`，或開對話框選 Configuration、RID、self-contained | `uv publish`／`twine upload` | `npm publish` |

Publish 類的設定**執行前一定要先確認**，因為它會對外發布。

## 6. 分階段計畫

每個 phase 都要能單獨使用、單獨 commit。照 TDD 流程：先寫測試，看到它失敗，再實作。

### Phase 0：Python 除錯原型（最先做）
目的：用最小的完整路徑，確認中斷點和變數在 Orca 裡的體驗。
- `dap-framing`、`dap-client`、stdio 傳輸
- AdapterManager：第一次使用時下載 debugpy wheel 並驗證
- 最小版 `DebugSessionManager`（單一 session，不處理子 session）
- Monaco：點 gutter 切換中斷點、標示目前停住的行
- Bottom panel 改成可以切換 tab，新增 Debug tab：工具列（Continue／Step Over／Into／Out／Stop）、Call Stack、Variables
- 暫時的入口：在 `.py` 檔的編輯器右鍵選「Debug this file」
- **驗收標準**：在 `.py` 檔下中斷點，啟動除錯後會停在那一行，看得到區域變數也能展開，逐步執行正常，按 Stop 之後程序確實結束
- 預估約 1,800 行（含測試）

**完成狀態（2026-09-26）**：驗收標準都已達成，由 `tests/e2e/debug-python-breakpoint.spec.ts` 在真正的 app 裡驗證。另外 `src/main/debug/debug-session.debugpy.integration.test.ts` 會跑真的 debugpy，設定 `ORCA_TEST_DEBUGPY_DIR` 才會執行。

- 入口：檔案樹在 `.py` 檔上按右鍵的「Debug 'x.py'」、Debug 面板工具列的同名按鈕、狀態列的「Debug」按鈕
- Python interpreter 的尋找順序：`.venv`、`venv`，最後是 PATH 上的 `python3`
- debugpy 下載到 `userData/debug-adapters/debugpy/<version>/`

**已知限制**（Phase 3、4 處理）：
- 被除錯的程式用 `internalConsole` 執行，**沒有 stdin**，所以 `input()` 無法使用。要改成 `runInTerminal`，在 Orca 終端機裡執行
- 同一時間只能有一個 debug session
- 中斷點和目前執行的行在同一行時，gutter 只看得到紅點，看不到箭頭（整行的底色還是會標示出來）
- 重新載入 renderer（例如 Cmd+R）不會停止正在跑的 session，要等 app 關閉時才會清掉

### Phase 1：執行設定基礎和 Run widget
- 擴充型別、settings normalize，確認舊設定讀得進來、存回去不會掉欄位
- 執行狀態 store `runSessionsByKey`（`running`／`succeeded`／`failed`／`stopped`，加上 `exitCode`）
- OSC 133 事件加上 `tabId`
- Run（`singleInstance` 時重用 tab）、Stop（`\x03`，3 秒內沒結束或連按兩次就關 PTY）、Rerun
- 右上角 `TitlebarRunWidget`
- 沒有 shell integration（OSC 133）的 shell：狀態顯示「未知」，■ 永遠可以按
- 預估約 800 行

**完成狀態（2026-09-26）**：已完成，由 `tests/e2e/tab-bar-run-configurations.spec.ts` 在真正的 app 裡驗證。實作時有兩個跟原計畫不同的決定：

1. **位置改在 tab bar，不放標題列。** Orca 的工作區畫面沒有標題列，tab group 會一路延伸到視窗頂端，所以「右上角」其實就是 tab bar 的最右邊。那裡本來就有 Orca 的 Quick Commands 分割按鈕（`▶ 名稱 ▾`），它已經是「設定選單＋執行」。所以做法是**升級這個按鈕**，而不是另外加一個：
   - ▶ 和選單裡的項目改用單一實例執行：同一個設定重用自己的 tab，還在跑的時候再按一次就重新執行
   - 旁邊加上 `RunSessionControls`：狀態點（綠色表示執行中或成功、紅色表示失敗）、↻ Rerun、■ Stop；目前編輯器是 `.py` 檔時多一個 🐞 Debug
   - 原本的選單功能（新增、編輯、刪除、agent prompt、遠端主機）全部保留，也就是 Edit Configurations 的角色
   - Agent prompt 類的指令維持原本「每次開新 tab」的行為
2. **Quick command 的資料結構完全沒改。** Orca Mobile 和較舊的桌面 client 用 `parseNormalizedTerminalQuickCommands` 檢查 quick command，要求**欄位完全一致**，多一個欄位就會拒收整份清單。所以 Phase 1 沒有加 `kind`、`singleInstance` 等欄位。**Phase 2 之後需要的執行設定資訊，要放在另一個以 command id 為 key 的本機 map，絕對不能加在共享的 quick command 物件上。**

**實作重點**：
- `ORCA_TERMINAL_COMMAND_FINISHED_EVENT` 多帶一個 `paneKey`，這樣才知道是哪個 tab 的指令結束了。Orca 的 shell integration 只在真的執行過指令後才送出 `133;D`，所以不需要監聽「指令開始」
- Stop：第一次按送出 Ctrl-C；狀態還是「停止中」時再按一次就關掉 tab。如果指令還在排隊、shell 還沒收到，就直接取消排隊的指令，不送 Ctrl-C（不然 Ctrl-C 只會清掉空的提示字元，永遠等不到結束訊號）
- Rerun：送出 Ctrl-C，等指令結束（最多 3 秒）後在同一個 tab 重跑；逾時就關掉 tab 開新的
- 執行狀態存在獨立的 zustand store（`components/run/run-session-store.ts`），不放在共享的 app store

**已知限制**：
- 沒有 OSC 133 的 shell（cmd.exe、部分 Git Bash）收不到結束訊號，狀態會停在「執行中」；Stop 按兩次仍然可以關掉 tab
- 指令已經送進 shell、但 shell 還沒開始執行的那一瞬間按 Stop，也收不到結束訊號，一樣要按第二次

### Phase 2 提前完成的部分：Python interpreter 和「Current File」（2026-09-26）

使用者要求 Run 也要能用 venv，而且可以自動偵測或事先設定，所以先做了 Python 這部分：

- **偵測**（`src/main/python/python-interpreters.ts`，main process）：依序是專案的 `.venv`、`venv`、`env`，有 `poetry.lock` 時加上 `poetry env info --path`，最後是 PATH 上的 `python3`／`python`。會用 real path 去除重複，每個都跑 `--version` 取得版本。Debug 也改用這個模組
- **事先設定**：每個專案（repo id）可以選「自動」或固定某個 interpreter，也可以用「選擇解釋器…」挑任意執行檔。**只存在本機的 localStorage**（`orca.python.interpreterByProject.v1`），不放在同步的 settings，也不動 quick command
- **UI**：開著 `.py` 檔時，focused tab group 的 tab bar 右邊會出現 `[Python 3.14 (.venv) ▾] ▶ 🐞 ● ↻ ■`。▶ 在終端機執行目前的檔案（例如 `.venv/bin/python scripts/x.py`），一樣是單一實例，也有 Stop 和 Rerun；🐞 用同一個 interpreter 除錯。資料夾型 workspace 也會顯示
- 沒有 quick command 時，原本的「Command」按鈕改名為「Add Configuration…」
- **遠端（SSH／remote runtime）**：沒辦法偵測，▶ 直接用 `python3`，由遠端的 shell 自己去找；🐞 會停用
- **驗證**：`tests/e2e/python-run-current-file.spec.ts` 會建立一個真的 venv，確認 Run 的輸出 `sys.prefix` 是那個 venv；接著固定成系統的 Python，確認 Run 和 Debug 都改用它

**已知限制**：Windows 上路徑有空白時會加雙引號，cmd 可以正常執行，但 PowerShell 需要在前面加 `&` 才能執行加了引號的程式路徑，這個還沒處理。

### Phase 2：專案偵測和右鍵選單
- .NET、Python、Node 偵測器和測試（用 fixture 目錄）
- 檔案樹右鍵的 Build／Run／Debug／Publish 和 `More Run/Debug` 子選單
- 快捷鍵：`run.run`、`run.debug`、`run.stop`、`run.rerun`（Mac 預設 `⌃R`／`⌃D` 要避免跟終端機裡的 shell 衝突，只在焦點不在終端機時生效）
- 預估約 1,000 行

**Phase 2 完成狀態（2026-09-26）**：`.NET` 和 Node 的偵測跟右鍵選單都完成了，由 `tests/e2e/project-run-configurations.spec.ts` 驗證。實作細節：

- **偵測器**是純函式（`src/shared/run-configurations/`），只吃檔案內容，所以本機、SSH、remote runtime 都能用。讀檔走 `readRuntimeDirectory`／`readRuntimeFileContent`，檔案操作的 context 用 `getTabEntryFileOperationContext`
  - Node：每個 script 產生一個設定；套件管理器依 `packageManager` 欄位或 lockfile 判斷；依 script 名稱分類成 build、run、test、publish；非 private 的套件額外加上 `<pm> publish`
  - .NET：`.csproj`、`.fsproj`、`.vbproj` 都有 Build；可執行的專案（Web、Worker SDK 或 `OutputType` 是 Exe）依 `launchSettings.json` 的 `Project` profile 產生 Run，依 `.pubxml` 產生 Publish（沒有 pubxml 就用 `-c Release`）；測試專案改成 Test；類別庫只有 Build。**沒有加 XML 解析的依賴**，目前用 regex 就夠
- **右鍵選單**：在資料夾、`package.json` 或 `.csproj` 上按右鍵，選單一打開就開始偵測。直接顯示 Build、Run、Test、Publish，其他的放在「More Run/Debug」子選單，依專案分組。Publish 一定要先確認，確認視窗會顯示完整的指令
- 指令在**專案所在的目錄**執行：`RunTarget.cwd` 會一路傳到 `runQuickCommandInNewTab` 的 `startupCwd`，跟「Open in Terminal」用的是同一個機制
- **tab bar**：最近一次從右鍵執行的設定會出現在 tab bar（`RecentRunControls`），可以一鍵重跑，也有 ● ↻ ■。fork 在 `TabGroupPanel` 只掛一個 `RunToolbar`
- **目前還沒做**：Python 專案層級的偵測（Django 的 `manage.py`、`pyproject.toml` 的 scripts）、`.sln`、快捷鍵、.NET／Node 的 🐞 Debug（Phase 3）

### Phase 3：擴充到 Node 和 .NET 除錯
- 子 session 支援（`startDebugging`）、TCP 傳輸、js-debug adapter
- netcoredbg adapter，包含各平台的 manifest（Intel Mac 鎖 3.1.3；Windows arm64 顯示「不支援」）
- `runInTerminal` → 開 Orca 終端機 tab
- Debug 按鈕接上 Run 設定的 `debug` 欄位
- 預估約 1,200 行

**Phase 3 完成狀態（2026-09-26）**：Node／TS 和 .NET 除錯都完成了，由 `tests/e2e/debug-node.spec.ts` 和 `tests/e2e/debug-dotnet.spec.ts` 在真正的 app 裡驗證。另外有兩個會跑真實 adapter 的整合測試，設定環境變數才會執行：`ORCA_TEST_JSDEBUG_DIR` 和 `ORCA_TEST_NETCOREDBG_DIR`。

- **js-debug**：用 Orca 自己的 Electron 當 Node（`ELECTRON_RUN_AS_NODE`）啟動 standalone server，監聽 localhost 的隨機 port。DAP client 支援 `startDebugging` 子 session，**每一條連線都能處理這個請求**，因為 `npm run dev` → `node app.js` 是孫 session，請求會從子 session 的連線送來。`resolveSourceMapLocations` 限定在專案內，避免 npm 內部的 source map 雜訊
- **netcoredbg**：除錯前會先 `dotnet build -c Debug`，輸出串到 Debug console，再從 build 輸出的 `Name -> path.dll` 找出要執行的組件；會套用 `launchSettings.json` profile 的環境變數、`applicationUrl`（對應 `ASPNETCORE_URLS`）和 `commandLineArgs`，而且是 main 自己讀這個檔
- **入口**：`.js`／`.ts` 檔在 tab bar 有 ▶ 🐞；`package.json` 的 run 類 script 在右鍵有「Debug」；`.csproj` 的 Run profile 在右鍵有「Debug」；C#、JS、TS 都可以在 gutter 下中斷點
- 除錯請求改成帶 **launch target**（`python-file`、`node-file`、`node-script`、`dotnet-project`），在 main 用 zod 驗證，每個 adapter 有自己的 `*-launch.ts`

**實測時抓到並修正的問題**（都有對應的測試）：
1. **netcoredbg 會把 `initialized` 和 `initialize` 的回應放在同一個 chunk 送來**，原本的 handshake 在收到回應之後才開始等 `initialized`，所以永遠等不到。現在改成先開始等，再送 `initialize`
2. **使用者的 `dotnet` 是 Intel（x86_64）版**，在 Apple Silicon 上所有 .NET 程式都透過 Rosetta 以 x64 執行，arm64 的 netcoredbg 附加不上去，會 SIGSEGV（crash report 顯示 `ManagedDebuggerHelpers::Startup` 拿到 null 的 debugger 介面）。現在**依 `dotnet` 執行檔 header 的架構挑 netcoredbg**（`executable-arch.ts`，支援 Mach-O、fat binary、ELF、PE），不看 Orca 自己的架構；架構不同時會在 console 說明
3. **adapter 自己 crash 時，它啟動的程式會變成孤兒程序**，永遠停在等 debugger 的狀態。現在 adapter 結束時，會把整個 process group 一起結束（POSIX）
4. **symlink 路徑**（例如 macOS 的 `/var` → `/private/var`）：build 記錄的是解析後的路徑，中斷點會綁不上、停住的行也對不回編輯器。現在 `DebugPathMapping` 送中斷點時轉成真實路徑，收到 stack frame 時再轉回編輯器用的路徑
5. adapter 暫存資料夾的清理改用 `removeTree`（Windows 上會重試），不再直接用遞迴的 `rm`

**已知限制**：
- Windows on Arm 沒有 netcoredbg，不能除錯 .NET；Intel Mac 用 netcoredbg 3.1.3
- .NET 沒有 Hot Reload 和 Edit-and-Continue
- 上游的 `windows-lane-tree-removal-boundary.test.ts` 在這個 fork 會失敗：它讀取 CI workflow 裡的檔案清單，但清單中的 `agent-foreground-process-git-bash.win32.test.ts` 不存在。這跟 fork 的改動無關

### Phase 4：完整的 Debug UI
- Watch、Debug Console（REPL + 自動補全）、Breakpoints 列表
- 行內變數值、hover 求值
- 條件中斷點、logpoint、例外中斷（依 adapter 回傳的 `exceptionBreakpointFilters` 顯示）
- 預估約 1,500 行

**Phase 4 完成狀態（2026-09-26）**：分成三個 commit，e2e 測試是 `debug-breakpoint-conditions.spec.ts` 和 `debug-watch-console-hover.spec.ts`，`debug-node.spec.ts` 也擴充了。

- **4a 中斷點**：中斷點移到獨立的 `breakpoint-store.ts`，每個中斷點有 `{ line, enabled, condition, hitCondition, logMessage }`，舊版只存行號的資料會自動轉換。在 gutter 按右鍵會開啟編輯器（那一行沒有中斷點時會先加一個）。gutter 圖示依狀態區分：實心點、條件（點中有橫線）、logpoint（菱形）、停用（灰色空心）、沒綁上（紅色空心）。是否綁上的狀態來自 `setBreakpoints` 的回應和之後的 `breakpoint` 事件（事件的路徑也經過 `DebugPathMapping` 轉換）。Debug 面板右欄改成 Console／Breakpoints 兩個分頁；例外中斷的選項由 adapter 的 capabilities 決定，沒改過之前用 adapter 的預設值，選擇會依 adapter 分開記住，並且在程式開始執行前就送出
- **4b 看值**：Watch 放在 Variables 下方，會跨 session 保留，每次暫停都重新求值；Console 可以輸入運算式在目前選取的 frame 求值，有 ↑／↓ 歷史紀錄；滑鼠移到變數上會顯示值（只在暫停的那個檔案，會包含 `a.b.c` 成員鏈，但不會包含函式呼叫）；暫停行之前的程式行會在行尾顯示變數值。**踩到的坑**：Monaco 的 injected text（`after`）放在行尾的空 range 上不會顯示，要用整行的 range 才會出現
- **4c 補齊**：「More Run/Debug」子選單每個可除錯的設定都有 Debug 項目；從選單除錯的設定也會成為 tab bar 上最近執行的那一個，而且那裡多了 🐞 按鈕

**仍未支援**：REPL 的自動補全（DAP `completions`）、在 Variables 裡直接修改變數值（`setVariable`）、function breakpoint、data breakpoint

### Phase 5：進階功能
- Edit Configurations 對話框（左邊清單、右邊表單）
- `beforeLaunch` 串接：每一步都等 OSC 133;D 回傳 exit 0 才繼續；不要用 `&&` 串（PowerShell 5 不支援）
- Compound 設定（一次跑多個）
- 匯入 `.vscode/launch.json`：`coreclr` 對應 netcoredbg，`debugpy`／`python` 對應 debugpy，`node`／`pwa-node` 對應 js-debug，`${workspaceFolder}` 等變數自己展開
- `orca.yaml` 的 `runConfigurations:` 共享設定，**一定要沿用 `issueCommand` 的 content hash 信任核准機制**（`PersistedTrustedOrcaHookRepo`），否則 clone 一個 repo 就可能被植入指令
- 預估約 1,500 行

**Phase 5 完成狀態（2026-09-26）**：在獨立分支 `feat/run-debug-phase5` 完成（從 cfc6e9793e 開出，和 Phase 4 平行進行），之後合併回 `feat/run-debug`；合併時 Phase 4 的 `adapterIdForTarget` 補上了兩種新 target。由 `tests/e2e/run-configurations-editor.spec.ts` 在真正的 app 裡驗證。

- **資料模型**（`src/shared/run-configurations/run-configuration-definition.ts`）：三種設定。`command`（指令、工作目錄、beforeLaunch）、`debug`（沿用 `DebugLaunchTarget`，加上 args、env、工作目錄、beforeLaunch）、`compound`（一起啟動的設定清單）。路徑可以寫相對於 workspace 根目錄，也可以用 `${workspaceFolder}`、`${file}` 等 VS Code 變數，執行時才展開（`run-configuration-variables.ts`）。`${env:…}`、`${input:…}` 這類無法解析的變數會直接報錯，不會帶著錯的路徑執行；其他 `${NAME}` 保留給 shell
- **儲存位置**：本機設定依照 repo id 存在 localStorage（`orca.run.configurationsByRepo.v1`），**沒有改動 quick command 的資料結構**（原因見 Phase 1）。要跟團隊共用，就寫在 `orca.yaml` 的 `runConfigurations:`，格式相同，`type` 可以省略（依欄位推斷），`id` 預設等於 `name`。讀的是**目前 workspace 自己的** orca.yaml，所以每個分支可以不一樣
- **Debug 新增兩種 target**：`python-module`（`python -m`）和 `dotnet-program`（直接除錯已編譯好的 dll，不先 build）。main 的 `DebugStartRequest` 多了選填的 `launchOptions`（args、env），在 `debug-launch-options.ts` 疊加到各 adapter 產生的 launch 參數上，zod 有限制長度和數量
- **beforeLaunch**（`run-configuration-plan.ts` + `run-configuration-launcher.ts`）：先展開成步驟清單（深度優先、同一個步驟只跑一次、偵測循環），再一步一步用 `runConfigurationAndWait` 執行，每一步都在自己的 tab 裡，等 OSC 133;D 回報 **exit 0** 才繼續；失敗、被停止、tab 被關掉都會中止並顯示 toast。沒有用 `&&` 串接
- **Compound**：所有成員的 beforeLaunch 先跑（合併去重），然後同時啟動所有成員。因為一次只能有一個 debug session，**compound 裡最多只能有一個 debug 設定**，超過會直接報錯
- **匯入 `.vscode/launch.json`**（`launch-json-import.ts`）：`debugpy`／`python`（`program` 或 `module`）、`node`／`pwa-node`（`program`，或 `runtimeExecutable` 是 npm/pnpm/yarn/bun 的 `run <script>`）、`coreclr`（`program`）、`compounds`。`attach`、瀏覽器、其他 runtime 會列出「不支援」。`preLaunchTask` 不匯入（VS Code task 不在範圍內），會提示使用者改用 beforeLaunch。重複匯入時，同一個設定會更新，不會重複新增
- **信任**：執行任何用到 orca.yaml 設定的東西（直接執行、被本機設定當作 beforeLaunch 或 compound 成員）之前，都會用新的 `runConfigurations` 種類走既有的 `confirmScriptContent`，hash 的內容是所有共享設定的完整 JSON，改任何一個欄位都會重新詢問。「Always trust orca.yaml」一樣有效
- **UI**：tab bar 的 Run 區多了設定選單（`RunConfigurationsWidget`）：目前設定的名稱 ▾、▶（debug 設定顯示 🐞）、狀態點和 ↻ ■。選單列出「本機」和「共享（orca.yaml）」兩組，還有 `Edit Configurations…` 和 `Import .vscode/launch.json`。Edit Configurations 對話框左邊是清單（新增命令／除錯／組合、複製、刪除），右邊是表單；共享設定唯讀，可以複製成本機設定。存檔時選中的設定會成為目前設定（跟 JetBrains 一樣）

**合併成單一 Run 元件（2026-09-26）**：使用者要求跟 JetBrains 一樣只有一個入口。原本 tab bar 有三個東西：最近一次從右鍵執行的設定（`RecentRunControls`）、upstream 的 Quick Commands 按鈕（沒有 quick command 時顯示「Add Configuration…」）、Phase 5 的設定選單。現在只剩 `RunWidget`：`[目前的項目 ▾] ▶ 🐞 ● ↻ ■`。

- 下拉選單依序列出：最近執行（從右鍵執行的暫時設定）、本機設定、共享設定（orca.yaml）、快速指令（repo 和全域，包含 agent prompt），接著是 Edit Configurations、匯入 launch.json、新增快速指令、管理快速指令（開設定頁）
- 選項只負責「選擇」，按 ▶ 或 🐞 才執行，跟 JetBrains 一樣。從檔案樹右鍵執行或除錯偵測到的設定時，會自動選中它
- 切換到某個執行中的 terminal tab 時，Run 元件會自動選中那個程式，顯示它的狀態和 ↻ ■（同時跑多個程式時用得到）。之後從選單另外選的項目，會維持到下次切換 tab
- ▶ 和 🐞 一直都在，不能用時是停用狀態：只能除錯的設定不能 ▶；只有 debug 設定和帶有除錯目標的偵測設定可以 🐞
- 最近執行會保存（`recent-run-store.ts`，localStorage 的 `orca.run.recentByWorktree.v1`），依 workspace 最多 5 筆，最新的在最前面，同一個設定只留一筆，重啟後還在
- 目前選擇存在 `selectedByRepo`，值是 `recent:<commandKey>`、`config:<id>` 或 `quick:<key>`；舊版的 `detected` 會當成最新一筆最近執行，只存 id 的值會當成 `config:<id>`
- `TabGroupPanel` 不再掛 upstream 的 `TabBarQuickCommandsButton`（元件本身沒刪），它的快捷鍵 `tab.openQuickCommandsMenu` 改由 `RunWidget` 用同一個 hook 接管。選中快速指令時，▶ 的名稱仍是「Run quick command: X」，upstream 的 e2e 不需要修改
- 取捨：快速指令的編輯和刪除改到設定頁；新增只會加到目前 workspace 的主機，不再提供選擇遠端主機

**實測時抓到的問題**：
1. 對話框裡的「+」原本是 DropdownMenu，第二次點擊時選單一打開就被 Dialog 的 focus trap 關掉（`modal={false}` 也一樣）。改成三個各自的新增按鈕
2. 單一實例會把指令打進**同一個 shell**，所以指令裡如果有裸的 `exit N`，會把 shell 關掉而不是讓指令失敗。這時 tab 會關閉，beforeLaunch 的等待會當成「被停止」處理，不會卡住

**Code review 後的修正**：
1. 設定選單的 ↻ Rerun 原本直接重打指令，orca.yaml 改過之後會**跳過信任確認**。現在 Rerun 走跟 ▶ 一樣的流程（重新讀 orca.yaml、信任確認、beforeLaunch）
2. 信任判斷原本漏掉「中間層」的 compound（本機 compound → 共享 compound → 本機設定）。現在 plan 會回傳所有經過的設定（`involvedIds`），只要有一個是共享的就要確認
3. compound 互相重複引用會指數爆炸，而且發生在信任確認之前。現在每個 compound 只展開一次，引用清單也會去重
4. 命令裡的 `${file}`、`${workspaceFolder}` 等變數會直接貼進 shell，檔名如果是 `x;curl …|sh;.py` 就會被執行。現在命令裡的變數值只允許一般路徑字元，含空白會加雙引號，含其他 shell 特殊字元就拒絕執行（debug 設定的路徑不經過 shell，不受限）
5. 執行前一律重新讀 orca.yaml，並用序號避免較慢的舊讀取覆蓋新的結果
6. shell 回報 `133;D` 但沒有 exit code（狀態 `finished`）時，當成正常結束

**已知限制**：
- 沒有 OSC 133 的 shell 收不到結束訊號，beforeLaunch 會一直等，要手動按 ■（按兩次會關 tab，然後中止）
- 命令裡的變數值如果含 `(`、`&` 等字元（例如 `Program Files (x86)` 底下的路徑）會被拒絕；WSL workspace 的 `${workspaceFolder}` 可能是 `\\wsl$\…` 路徑，在 WSL 的 shell 裡不能用（尚未實測）
- 匯入 `.vscode/launch.json` 是使用者主動操作，匯入的設定變成本機設定，**不會再詢問信任**（跟 VS Code 一樣直接執行 launch.json）。匯入前請先看過檔案內容，特別是 `env` 和 `python`
- 本機設定只存在這台電腦；要共用請放 orca.yaml
- 命令設定還沒有 env 欄位（各種 shell 設定環境變數的語法不同），需要的話寫在指令裡

## 7. 必須遵守的專案規則（摘自 AGENTS.md）

- UI 依照 `docs/STYLEGUIDE.md`，使用 `main.css` 的 token 和 `components/ui/` 的 shadcn 元件；`pnpm run check:code-quality:changed` 必須通過
- 啟動子程序只能用 `src/shared/child-process/` 的 `spawnProcess`
- 不能加 `max-lines` 的 disable；檔案名稱不能用 `utils`、`helpers` 這種模糊名稱
- 盡量不用 type assertion；真的需要時要附 `SAFETY:` 註解
- 所有字串要走 i18n（`en.json`，並補上 `zh.json`）
- 快捷鍵要處理跨平台（Mac 用 `metaKey`，其他平台用 `ctrlKey`）；路徑一律用 `path.join`
- 驗證 Electron UI 時一律用 `ORCA_BACKGROUND_LAUNCH=1` 在背景啟動，用 CDP 截圖，不能搶視窗焦點
- 驗證指令：`pnpm tc`、`pnpm test <path>`、`pnpm run check:code-quality:changed`

## 8. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| netcoredbg 平台缺口 | Intel Mac 只能用舊版；Windows arm64 無法除錯 .NET | manifest 依平台鎖定版本；不支援的平台在 UI 明確顯示，不要靜默失敗 |
| netcoredbg 的 macOS arm64 是社群支援 | 可能有 bug | Phase 3 在這台 Apple Silicon Mac 上實測，把已知問題記錄在本文件 |
| js-debug 子 session | client 沒實作好會直接壞掉 | Phase 3 為 `startDebugging` 寫專門的測試 |
| adapter 下載失敗（離線、proxy、公司防火牆） | 無法除錯 | 顯示清楚的錯誤訊息，並提供「手動指定 adapter 路徑」的設定 |
| 被除錯的程序變成孤兒程序 | 佔用 port 或 CPU | session 結束或 Orca 關閉時一定要清理；參考現有的 terminal 孤兒程序清理機制 |
| 跟 upstream 衝突 | 同步 upstream 很痛苦 | 遵守 D6；bottom panel、Monaco、右鍵選單的改動要盡量小 |

## 9. 不在這一輪的範圍（之後再做）

- **WSL 和 SSH 遠端除錯**：需要在 SSH relay 新增 `proc.spawn`（雙向串流 stdio）和 `proc.connectTcp`（接到遠端的 js-debug）。現有的 `agent.execNonInteractive` 會把輸出整個緩衝（上限 4 MB、預設 60 秒逾時），不能用在這裡。relay 的新方法**一定要做版本能力協商**（見 `docs/reference/remote-wire-compatibility.md`），adapter 也要下載到遠端主機。WSL 需要處理 `\\wsl$\…` 和 `/home/…` 的路徑轉換
- .NET Hot Reload 和 Edit-and-Continue（netcoredbg 不支援）
- JetBrains `.run/*.run.xml` 匯入（沒有公開的 schema，只能盡力支援）
- Python interpreter 用 `python-environment-tools`（pet）偵測：它沒有單獨發布執行檔，要自己為各平台編譯
- Run Unit Test、程式碼檢查、重構等 IDE 語言分析功能

## 10. 參考資料

- netcoredbg：https://github.com/Samsung/netcoredbg（Apple Silicon 相關：issue #102）
- vsdbg 授權限制：https://github.com/dotnet/vscode-csharp/issues/7412
- debugpy：https://github.com/microsoft/debugpy、https://pypi.org/project/debugpy/
- vscode-js-debug：https://github.com/microsoft/vscode-js-debug（standalone DAP：issue #1388；子 session 相關：helix-editor/helix#11906）
- DAP 規格：https://microsoft.github.io/debug-adapter-protocol/specification
- mason-registry：https://github.com/mason-org/mason-registry
- `@vscode/debugprotocol`：https://github.com/microsoft/vscode-debugadapter-node
- OpenSumi（設計參考）：https://github.com/opensumi/core
- `package-manager-detector`：https://github.com/antfu-collective/package-manager-detector
- Rider Run/Debug 設定（UX 參考）：https://www.jetbrains.com/help/rider/Run_Debug_Configuration.html
