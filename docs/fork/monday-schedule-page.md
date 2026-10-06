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
- 已完成的任務用刪除線；「隱藏已完成」可以藏起來。沒有任何日期的任務不畫，狀態列顯示數量，點開可以看清單。
- 點長條、旗標或甘特的列 → 右側詳情面板：時程、Due、狀態、優先順序、人員、其他欄位、描述、子項目、updates 和回覆。面板開著時點別的任務會直接切換。

## 「只顯示誰的」

工具列的下拉選單選一個人（或「全部人」），預設是 token 所屬的帳號。篩選在 monday 端做，用人員欄的 `person-<使用者 ID>` 規則，**不用** monday 的 `assigned_to_me`：那個值代表 token 的擁有者，而 token 不一定是使用 Orca 的人的（例如訪客帳號不能產生 token，只能用同事的）。

選了人時可以勾「也顯示沒有指派人的任務」（預設開）：個人 board（例如「Omars's Task」）大部分任務沒填人員（730 個只有約 80 個有填），只看指派的會幾乎全部被濾掉。「Project Cases」沒指派的只有 24 個舊任務。人員清單來自 monday 的 `users`，排除停用、刪除的帳號和 monday 的 AI agent，每次連線只讀一次。

## 依狀態篩選（2026-10-06）

工具列的「狀態」下拉選單可多選要顯示的狀態，沒選就是全部。和「只顯示誰的」不同，這個篩選在 Orca 端對已讀進來的任務做，切換不花 monday API 額度。

- 選項是目前這幾個 board 上出現的狀態，**依名稱合併**（各 board 的狀態欄 id 不同，但「Done」「Stuck」這類名稱常共用），附任務數；順序是未完成的狀態、完成的狀態、「沒有狀態」。
- 開著「隱藏已完成」時，完成的狀態不列出來。
- 選擇存在 view prefs（`statusLabels`），存的是名稱；換了 board 後不存在的名稱仍列在選單裡（數量 0），才能取消。

## 內嵌瀏覽器（2026-10-06）

頁面裡的連結（在 monday 開啟、開啟 monday、Web CRM 網址、欄位與 update 裡的連結、token 說明）都開在 monday 頁右側的 Orca 瀏覽器，不切離頁面；**Shift+點擊**改用系統瀏覽器，面板標題列也有「用系統瀏覽器開啟」。

- 瀏覽器分頁一定要屬於某個 workspace，所以加了第三個本機虛擬 workspace `global-monday-browser`（`MONDAY_BROWSER_WORKTREE_ID`，和浮動終端機、SSH 頁同一張清單），路由、清理、paired web client 同步都照虛擬 workspace 處理。桌面版的虛擬 workspace 本來就能開瀏覽器（只有 paired web client 不行），浮動面板就是先例；面板直接重用 `FloatingBrowserSlot`。
- 面板顯示與否＝這個 workspace 裡有沒有瀏覽器分頁，不另存狀態；關閉面板就是關掉那個分頁。同一個網址已經開著就切過去，否則在同一個瀏覽器裡多開一頁。只接受 http(s)。
- 寬度可拖曳，存在 view prefs（`browserWidth`，最小 360px，月曆至少留 480px）。
- 標題列「移到浮動視窗」：把各頁網址依原順序在浮動 workspace 開成一個瀏覽器（保留原本正在看的那頁），再關掉頁內的面板，並打開浮動面板（浮動功能關著就順便開啟，同 OS「開啟檔案」那條路）。guest 不能換 workspace，所以頁面會重新載入；兩邊同一個 browser profile，登入不掉。
- 上游 `browser-hydration-actions.ts` 原本只放行浮動 id，改成 `addLocalSyntheticWorkspaceIds()`，重開 Orca 後 monday 的瀏覽器才會還原（unified tab 那邊本來就會保留，不改會留下懸空的分頁）。
- monday 頁離開時會卸載，回來時 guest 會重新掛上（登入 cookie 在預設的 browser profile，不受影響）。Orca 瀏覽器的登入和系統瀏覽器分開，第一次要在裡面登入 monday。
- 已知：焦點在 monday 瀏覽器裡時，Cmd+W 會關掉這個瀏覽器（依來源找到所屬 workspace）；新分頁、切換分頁等快捷鍵仍作用在目前的專案 workspace。

## 架構

| 位置 | 內容 |
|---|---|
| `src/shared/monday/` | 型別、IPC 輸入的 zod schema、欄位角色偵測（`detectMondayColumnRoles`）、時程計算（`computeMondayItemSchedule`） |
| `src/main/monday/` | token 儲存（`KeptPasswords`：有 keychain 就加密存在 `userData/monday/`，沒有就只放記憶體，**絕不存明文**）、GraphQL client（`API-Version: 2026-07` 固定、錯誤分類、被限流時等一次再重試）、排程載入（多個 board 用 alias 合成一次請求，board 結構在這次執行裡快取）、IPC `monday:*` |
| `src/preload/api/monday-*` | `window.api.monday` |
| `src/renderer/src/components/monday/` | 頁面、獨立 zustand store（不碰上游的 app store）、月曆／甘特版面模型、詳情面板、board 選擇器 |

上游檔案只加一行分支：`TopLevelView`／`isTopLevelView`／`UiViewHistory`／`TopLevelViewSchema`、右側欄隱藏清單、`AppWorkspaceShell`、`SidebarNav`、`register-core-handlers`、preload 的 `api-types`／`index`；內嵌瀏覽器另改了 `browser-hydration-actions.ts` 兩行（見上）。

## API 用量

monday 的每日上限是**整個帳號共用**。所以：不在背景輪詢；同一組 board 這次執行讀過就重用（按「重新整理」才重讀）；一般載入是一次呼叫（第一次多一次讀 board 結構）；每個 board 最多讀 2,000 個任務（4 頁），超過會在狀態列提示。

## 測試

- 單元：欄位偵測（用兩個真實 board 的欄位當 fixture）、時程計算、月曆分道（lane）與甘特版面、GraphQL 錯誤分類與重試、token 儲存（沒有 keychain 不寫檔）、詳情對應、圖片轉連結。
- e2e：`tests/e2e/monday-schedule.spec.ts`，搭配 `tests/e2e/helpers/fake-monday-server.ts`。端點覆寫 `ORCA_MONDAY_API_URL_FOR_TESTS` 只在非打包版生效（打包版的 token 只會送到 monday）。
- happy-dom 裡的 DOMPurify 行為不正確，所以 update HTML 的淨化在 e2e（Chromium）裡驗證。

## 之後可以做

- 寫入：拖曳長條／旗標改日期、改狀態、發 update（需要先確認寫入是以使用者本人名義）。
- 每個 board 手動調整欄位角色（目前只有自動偵測）。
- 週檢視、從任務開 workspace。
