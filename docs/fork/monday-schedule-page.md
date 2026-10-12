# monday 時程頁（fork 專屬）

> 狀態：v1 已實作（唯讀），分支 `feat/monday-calendar`，2026-10-05。
> 取代 `fork/feat/monday` 上「Tasks 頁第五種來源」的舊計畫：那份計畫刻意不做月曆和時間軸，而使用者的痛點正好在那裡。

## 要解決的痛點

1. monday 的月曆／甘特只能選一個日期欄來畫：Due date **或** timeline，不能同時看，很難掌控時程。
2. 在 monday 的月曆上點 task，看不到 task 的內容（描述、updates）。

## 使用者決定（2026-10-05）

| # | 決定 |
|---|---|
| D1 | **獨立頁面**：左側欄 Database 下方的「monday」入口（`TopLevelView: 'monday'`），不放進 Tasks 頁 |
| D2 | **月曆＋甘特都做**，兩種畫面都同時畫出時程長條和 Due date 旗標 |
| D3 | **唯讀**：看時程、點開看完整內容；寫入（拖曳改日期、改狀態、發 update）以後再說 |
| D4 | **選多個 board**，用「只顯示誰的」下拉選單篩人（2026-10-05 由「只看我的」開關改成下拉選單） |

## 畫面規則

- **長條（時程）**：board 有 timeline 欄就用它；沒有就用「開始日期 → Due Date」；只有開始日期就畫一天。
- **旗標（Due date）**：落在長條上就畫在長條上；不在長條範圍內（或沒有長條）就在那天另畫一個虛線框的旗標。
- **標紅**：Due 早於長條結束（計畫超過自己的期限，長條超出的部分也標紅），或已逾期（沒完成且過了 Due；沒有 Due 就看長條結束日）。
- 已完成的任務用刪除線；「隱藏已完成」可以藏起來。
- **沒有日期的任務**（2026-10-12）：沒有 timeline、開始日期、Due 的任務畫不進月曆／甘特，改列在畫面**左側**的「沒有日期」清單，兩種檢視共用。依 board 分組（board 順序同選擇器；全部來自同一個 board 時不顯示分組標題），組內照 monday 的順序、已完成的排最後；每列是狀態色點、名稱（最多兩行）、狀態 · group。點了開右側詳情面板。
  - 放左邊是因為右邊已經有詳情面板和內嵌瀏覽器；不在甘特圖裡加空白列，是因為個人 board 大量沒日期的任務會把有時程的列擠下去，而且月曆沒有對應的位置。
  - 狀態列的「N 個沒有日期」改成開關這個清單（之前是彈出清單），清單標題列也能收起；開關存在 view prefs（`showUndated`，預設開）。沒有這種任務時清單不出現。狀態篩選和「隱藏已完成」一樣作用在這份清單。
- 點長條、旗標或甘特的列 → 右側詳情面板：時程、Due、狀態、優先順序、人員、其他欄位、描述、子項目、updates 和回覆。面板開著時點別的任務會直接切換。

## 「只顯示誰的」

工具列的下拉選單選一個人（或「全部人」），預設是 token 所屬的帳號。篩選在 monday 端做，用人員欄的 `person-<使用者 ID>` 規則，**不用** monday 的 `assigned_to_me`：那個值代表 token 的擁有者，而 token 不一定是使用 Orca 的人的（例如訪客帳號不能產生 token，只能用同事的）。

選了人時可以勾「也顯示沒有指派人的任務」（預設開）：個人 board（例如「Personal Tasks」）大部分任務沒填人員，只看指派的會幾乎全部被濾掉。人員清單來自 monday 的 `users`，排除停用、刪除的帳號和 monday 的 AI agent，每次連線只讀一次。

## 依狀態篩選（2026-10-06）

工具列的「狀態」下拉選單可多選要顯示的狀態，沒選就是全部。和「只顯示誰的」不同，這個篩選在 Orca 端對已讀進來的任務做，切換不花 monday API 額度。

- 選項是目前這幾個 board 上出現的狀態，**依名稱合併**（各 board 的狀態欄 id 不同，但「Done」「Stuck」這類名稱常共用），附任務數；順序是未完成的狀態、完成的狀態、「沒有狀態」。
- 開著「隱藏已完成」時，完成的狀態不列出來。
- 選擇存在 view prefs（`statusLabels`），存的是名稱；換了 board 後不存在的名稱仍列在選單裡（數量 0），才能取消。

## 內嵌瀏覽器（2026-10-06）

頁面裡的連結（在 monday 開啟、開啟 monday、Client CRM 網址、欄位與 update 裡的連結、token 說明）都開在 monday 頁右側的 Orca 瀏覽器，不切離頁面；**Shift+點擊**改用系統瀏覽器，面板標題列也有「用系統瀏覽器開啟」。

- 瀏覽器分頁一定要屬於某個 workspace，所以加了第三個本機虛擬 workspace `global-monday-browser`（`MONDAY_BROWSER_WORKTREE_ID`，和浮動終端機、SSH 頁同一張清單），路由、清理、paired web client 同步都照虛擬 workspace 處理。桌面版的虛擬 workspace 本來就能開瀏覽器（只有 paired web client 不行），浮動面板就是先例；面板用自己的 `MondayBrowserSlot`（上游 v1.4.224 拿掉了 `FloatingBrowserSlot`）。
- 面板顯示與否＝這個 workspace 裡有沒有瀏覽器分頁，不另存狀態；關閉面板就是關掉那個分頁。同一個網址已經開著就切過去，否則在同一個瀏覽器裡多開一頁。只接受 http(s)。
- 寬度可拖曳，存在 view prefs（`browserWidth`，最小 360px，月曆至少留 480px）。
- 標題列「在獨立視窗開啟」（2026-10-12 取代原本的「移到浮動視窗」）：把**正在看的那頁**移到一個獨立的 OS 視窗，其他頁留在面板；那是最後一頁就順便關掉面板。獨立視窗不屬於任何 workspace，所以不會被收進浮動工作區。guest 不能換視窗，頁面會重新載入；視窗用 monday 分頁同一個 browser profile 的 partition，登入不掉。
  - 主程序 `src/main/browser/standalone-browser-window.ts` 重用上游的 `openPopupWithOriginBar`（原生外框＋顯示來源網域的 origin bar），IPC `monday:openBrowserWindow` 只收主視窗送來的 http(s) 網址，profile 由 `browserSessionRegistry.resolveKnownPartition` 換成 partition。
  - 視窗裡 `target=_blank`／Cmd+點擊開成另一個全尺寸獨立視窗；OAuth 這類帶名稱或尺寸的彈窗保留 `window.opener`，用小視窗開；非網頁一律拒絕；同時最多 12 個。
  - 沒有 Orca 的 renderer 幫忙處理快捷鍵，視窗自己接：Cmd/Ctrl+R 重新載入、Cmd/Ctrl+W 關閉、上一頁／下一頁（macOS Cmd+[ ／ Cmd+]，其他平台 Alt+←／→）。
  - 依背景啟動政策顯示（`showWindowWithoutStealingFocus`），e2e 不會搶焦點。
- 上游 `browser-hydration-actions.ts` 原本只放行浮動 id，改成 `addLocalSyntheticWorkspaceIds()`，重開 Orca 後 monday 的瀏覽器才會還原（unified tab 那邊本來就會保留，不改會留下懸空的分頁）。
- monday 頁離開時會卸載，回來時 guest 會重新掛上（登入 cookie 在預設的 browser profile，不受影響）。Orca 瀏覽器的登入和系統瀏覽器分開，第一次要在裡面登入 monday。
- 已知：焦點在 monday 瀏覽器裡時，Cmd+W 會關掉這個瀏覽器（依來源找到所屬 workspace）；新分頁、切換分頁等快捷鍵仍作用在目前的專案 workspace。

## 交給 AI（2026-10-12）

詳情面板標題列的「交給 AI」把 task 交給 agent。內容等詳情讀完才組（按鈕之前是停用的），**一律貼成草稿**，使用者補一句指示再按 Enter 送出。

- **在 workspace 開新 agent**：列出最近用過的 10 個 workspace（和 Cmd+J 空白查詢同一個排序 `orderEmptyQueryWorktrees`，不含封存），子選單是那個 workspace 所在主機偵測到的 agent（SSH／paired runtime 列遠端的，預設 agent 排第一）。選了就開新分頁、切到那個 workspace。做法照上游 fix-checks：`launchAgentInNewTab` 加 `beforeSurfaceOpen` 先 `activateAndRevealWorktree`，所以 native chat 的 agent 也會切過去。
- **在專案裡開新 workspace**：列出 git 專案（資料夾專案沒有 worktree 可開），用上游的 `launchWorkItemDirect` 建 workspace＋預設 agent＋草稿。名稱是 task 名稱，分支種子 `monday-<item id>`（task 名稱多半是中文，slug 之後是空的）。專案要先選設定（例如 setup 設成每次詢問）時改開「新 workspace」對話框並把內容放進剪貼簿。
- **複製給 AI 的內容**：同一份內容放到剪貼簿。
- 沒做「送給正在跑的 agent」：上游的送出路徑會直接送出，和「草稿」的決定衝突。

內容（`monday-task-agent-prompt.ts`）：任務、board · group、monday 連結、時程／Due／狀態／優先順序／人員（有排程資料時）、其他欄位、連結的記錄（**只帶名稱和網址**，其他欄位可能有不該交給 agent 的資料）、描述、子任務、updates 和回覆（由新到舊）。update 的 HTML 轉成文字（`mondayHtmlToText`）：連結寫出完整網址（monday 會把長網址縮成「…」）、圖片寫成「[圖片] 網址」（要登入 monday 才看得到）、@提及不附網址、script／style 不算文字。貼進終端機前去掉控制字元和 bidi 控制字元，長度上限和上游 linked context 一樣 12,000 字，超過時從最舊的 update 截掉並註明。

## 架構

| 位置 | 內容 |
|---|---|
| `src/shared/monday/` | 型別、IPC 輸入的 zod schema、欄位角色偵測（`detectMondayColumnRoles`）、時程計算（`computeMondayItemSchedule`） |
| `src/main/monday/` | token 儲存（`KeptPasswords`：有 keychain 就加密存在 `userData/monday/`，沒有就只放記憶體，**絕不存明文**）、GraphQL client（`API-Version: 2026-07` 固定、錯誤分類、被限流時等一次再重試）、排程載入（多個 board 用 alias 合成一次請求，board 結構在這次執行裡快取）、IPC `monday:*` |
| `src/preload/api/monday-*` | `window.api.monday` |
| `src/renderer/src/components/monday/` | 頁面、獨立 zustand store（不碰上游的 app store）、月曆／甘特版面模型、詳情面板、board 選擇器 |

上游檔案只加一行分支：`TopLevelView`／`isTopLevelView`／`UiViewHistory`／`TopLevelViewSchema`、右側欄隱藏清單、`AppWorkspaceShell`、`SidebarNav`、`register-core-handlers`、preload 的 `api-types`／`index`；內嵌瀏覽器另改了 `browser-hydration-actions.ts` 兩行（見上）；獨立視窗另改了 `popup-origin-bar-window.ts`（可傳 `show: false`、回傳 `window`）和 `foreground-activation-policy.ts`（`showWindowWithoutStealingFocus` 收 `BaseWindow`）；交給 AI 另改了 `launch-work-item-direct(-types).ts`（`LaunchableWorkItem.workspaceName`：沒有編號的項目用它當名稱種子）和 `QuickLaunchButton.tsx`（`orderAgents` 加 `export`）。

## API 用量

monday 的每日上限是**整個帳號共用**。所以：不在背景輪詢；同一組 board 這次執行讀過就重用（按「重新整理」才重讀）；一般載入是一次呼叫（第一次多一次讀 board 結構）；每個 board 最多讀 2,000 個任務（4 頁），超過會在狀態列提示。

## 測試

- 單元：欄位偵測（用兩個真實 board 的欄位當 fixture）、時程計算、月曆分道（lane）與甘特版面、GraphQL 錯誤分類與重試、token 儲存（沒有 keychain 不寫檔）、詳情對應、圖片轉連結、交給 AI 的內容（HTML 轉文字、控制字元、長度上限、連結記錄不帶帳密）和啟動參數（草稿、workspace 名稱、對話框退路）。
- e2e：`tests/e2e/monday-schedule.spec.ts`，搭配 `tests/e2e/helpers/fake-monday-server.ts`。「交給 AI」選單和複製的內容也在這裡驗證（換掉 `clipboard:writeText` IPC，不碰系統剪貼簿）。端點覆寫 `ORCA_MONDAY_API_URL_FOR_TESTS` 只在非打包版生效（打包版的 token 只會送到 monday）。
- happy-dom 裡的 DOMPurify 行為不正確，所以 update HTML 的淨化在 e2e（Chromium）裡驗證。

## 之後可以做

- 寫入：拖曳長條／旗標改日期、改狀態、發 update（需要先確認寫入是以使用者本人名義）。
- 每個 board 手動調整欄位角色（目前只有自動偵測）。
- 週檢視、從任務開 workspace。
