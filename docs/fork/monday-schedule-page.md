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
| D4 | **選多個 board，預設「只看我的」**，可以關掉看全部 |

## 畫面規則

- **長條（時程）**：board 有 timeline 欄就用它；沒有就用「開始日期 → Due Date」；只有開始日期就畫一天。
- **旗標（Due date）**：落在長條上就畫在長條上；不在長條範圍內（或沒有長條）就在那天另畫一個虛線框的旗標。
- **標紅**：Due 早於長條結束（計畫超過自己的期限，長條超出的部分也標紅），或已逾期（沒完成且過了 Due；沒有 Due 就看長條結束日）。
- 已完成的任務用刪除線；「隱藏已完成」可以藏起來。沒有任何日期的任務不畫，狀態列顯示數量，點開可以看清單。
- 點長條、旗標或甘特的列 → 右側詳情面板：時程、Due、狀態、優先順序、人員、其他欄位、描述、子項目、updates 和回覆。面板開著時點別的任務會直接切換。

## 「只看我的」

monday 的 `assigned_to_me` 篩選，加上「沒有指派人」：個人 board（例如「Omars's Task」）大部分任務沒填人員（730 個只有約 80 個有填），只用 `assigned_to_me` 會幾乎全部被濾掉。「Project Cases」沒指派的只有 24 個舊任務。篩選在 monday 端做（一個 `or` 規則），不是抓全部再濾。

## 架構

| 位置 | 內容 |
|---|---|
| `src/shared/monday/` | 型別、IPC 輸入的 zod schema、欄位角色偵測（`detectMondayColumnRoles`）、時程計算（`computeMondayItemSchedule`） |
| `src/main/monday/` | token 儲存（`KeptPasswords`：有 keychain 就加密存在 `userData/monday/`，沒有就只放記憶體，**絕不存明文**）、GraphQL client（`API-Version: 2026-07` 固定、錯誤分類、被限流時等一次再重試）、排程載入（多個 board 用 alias 合成一次請求，board 結構在這次執行裡快取）、IPC `monday:*` |
| `src/preload/api/monday-*` | `window.api.monday` |
| `src/renderer/src/components/monday/` | 頁面、獨立 zustand store（不碰上游的 app store）、月曆／甘特版面模型、詳情面板、board 選擇器 |

上游檔案只加一行分支：`TopLevelView`／`isTopLevelView`／`UiViewHistory`／`TopLevelViewSchema`、右側欄隱藏清單、`AppWorkspaceShell`、`SidebarNav`、`register-core-handlers`、preload 的 `api-types`／`index`。

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
