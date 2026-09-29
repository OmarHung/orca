# monday.com 任務來源：實作計畫（fork 專屬）

> 狀態：只有計畫，暫不實作（使用者 2026-09-29 決定）。要開工時從 Phase 0 開始
> 分支：`feat/monday`（worktree `/Users/omar/myprojects/orca-worktrees/feat-monday`），每個 Phase 完成後合回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 目標

公司（Autron／澳康，`autrontech.monday.com`）用 monday.com 管任務：每個人有自己的 Task board（例如「Omars's Task」，用 group 分「This Week」「Tasks」「已完成」和各專案），專案案件在「Project Cases」board（每月的維運 group 和各客戶專案 group）。

目標：**monday.com 成為 Orca Tasks 頁的第五種任務來源**，跟 GitHub、GitLab、Linear、Jira 並列：

1. 在 Tasks 頁切到 monday，看 board 的 item 清單，也能看跨 board 的「指派給我的 item」
2. 打開 item 看詳情：欄位值、描述、updates（含回覆）、子項目
3. 從 item「開工」：開新 workspace 視窗並帶入名稱，建好的 worktree 記住連結的 item，卡片上看得到
4. 在 Orca 裡寫回 monday：改狀態、在 item 下發 update、建新 item

## 2. 已確定的決策（使用者，2026-09-29）

| # | 決策 | 內容 |
|---|---|---|
| D1 | 放置位置 | **Tasks 頁的第五種來源**（`TaskProvider` 加 `'monday'`），不做成獨立頁面。使用者接受代價：要改幾十個上游檔案，之後同步上游時 Tasks 頁一改就容易衝突 |
| D2 | 寫入功能 | 第一版就要：**改狀態、發 update、建新 item** |
| D3 | 清單範圍 | **兩種都要**，用切換鈕選：(a) 選 board，再用 group／狀態／人員篩選；(b) 跨 board 的「指派給我」 |

以下是依照現有程式和 monday API 限制定的技術決策：

| # | 決策 | 內容 |
|---|---|---|
| T1 | 認證 | **Personal API token**（monday 頭像選單 → Developers → My access tokens）。不做 OAuth：OAuth 要有 client secret，桌面 app 藏不住 |
| T2 | Token 存放 | 只存在 main：`~/.orca/monday-accounts.json`（帳號資料，0600）＋ `~/.orca/monday-tokens/<accountId>.enc`（`getSecretStore()` 加密，用 `integration-credential-file.ts` 的原子寫入）。Token 永遠不送到 renderer。**加密不可用時不存明文**，只記在這次執行的記憶體裡（跟 Database D7 一致；Jira／Linear 在這種情況會退回明文 0600 檔，這裡刻意不跟） |
| T3 | 執行位置 | v1 只由**桌面端 main process** 呼叫（IPC），本機、SSH、WSL、資料夾 workspace 都走這條。遠端 runtime（`runtime:*` 的 project，Jira 會改走遠端 Orca 伺服器的 RPC）v1 不支援：monday 來源顯示「不支援遠端 runtime」，從這種 project 開工時不附 monday 的連結（舊版或上游的伺服器會拒絕 `'monday'`，連帶讓建立 worktree 失敗）。手機也不支援（Jira 一樣不在手機的 RPC allowlist） |
| T4 | 呼叫次數 | monday 的**每日呼叫上限是整個帳號共用**（Pro 方案 10,000 次／天，UTC 午夜重置；claude.ai 的 monday connector 的呼叫也算在內）。所以：多個 board 合成**一次** GraphQL 請求（alias），清單有快取，**不在背景輪詢**，只在切到頁面、按重新整理、寫入後重新讀取 |
| T5 | 欄位對應 | monday 的欄位是每個 board 自訂的（同樣是「狀態」，一個 board 叫 `status`、另一個叫 `status8`；Priority 也是 status 型別）。依型別和標題**自動偵測**狀態、負責人、到期日、優先順序欄位，每個 board 可以在 Orca 裡手動改 |
| T6 | Update 格式 | 發 update 時用 markdown 輸入，送出前用現有的 `marked` 轉成 monday 要的 HTML；顯示 update 時把 HTML 用現有的 `dompurify` 淨化後顯示 |
| T7 | ID | monday 的 board／item ID 已經超過 32 位元整數（例如 `18402100481`），**一律用字串存**，不要轉成 number |
| T8 | 降低衝突 | monday 專屬的程式碼放在新檔案（`src/main/monday/`、`src/shared/monday/`、`src/preload/api/monday-*`、`src/renderer/src/components/task-page/monday/`…）；上游檔案只加 provider 分支，照 Jira 分支旁邊的位置加，讓衝突容易看懂 |

## 3. monday API 摘要

- Endpoint：`POST https://api.monday.com/v2`，GraphQL；header `Authorization: <token>`、`API-Version: <固定版本>`（Phase 0 選當時的 stable 版本寫死成常數，升版另外做）
- 目前使用者：`me { id name email account { id slug name tier } }`，連線測試和帳號識別都用它；`slug` 用來組 item 網址（item 本身也有 `url` 欄位）
- Board 清單：`boards(limit, page, state: active, order_by: used_at) { id name workspace { id name } }`
- Board 結構：`boards(ids) { columns { id title type settings_str } groups { id title color } }`；status 欄的 labels 有 `is_done`，用來判斷「完成」
- Item 清單：`boards(ids) { items_page(limit ≤ 500, query_params: { rules, operator }) { cursor items { … } } }`，下一頁用 `next_items_page(cursor)`（cursor 60 分鐘失效）
  - 指派給我：people 欄 `compare_value: ["assigned_to_me"], operator: any_of`（**Phase 0 要實測**：monday 另一份文件說 query_params 對 people 欄無效，要改用 `items_page_by_column_values`）
  - 跨 board：API 沒有跨 board 查詢，用 GraphQL alias 把多個 board 放進同一個請求（一次呼叫）
- Item 詳情：`items(ids) { name url state group board column_values { id type text value … } description subitems updates_page { … replies { … } } }`
- 寫入：
  - 改狀態：`change_column_value(board_id, item_id, column_id, value: "{\"index\": N}")`
  - 發 update：`create_update(item_id, body: <HTML>)`；回覆用 `parent_id`
  - 建 item：`create_item(board_id, group_id, item_name, column_values: <JSON>)`
- 限制（Pro 方案）：每日 10,000 次（帳號共用）、每分鐘 2,500 次、同時 100 個、complexity 每分鐘 5M（讀寫分開）。超過會回 `DAILY_LIMIT_EXCEEDED`、`Minute limit rate exceeded`、`ComplexityException`，帶 `retry_in_seconds`／`Retry-After`；被限流的請求算 0.1 次
- 網址格式：`https://<slug>.monday.com/boards/<boardId>/pulses/<itemId>`（也可能是 `/boards/<boardId>/views/<viewId>/pulses/<itemId>`）

## 4. 架構

### 4.1 現況：Jira 是怎麼接的（2026-09-29 盤點）

- Tasks 頁**沒有「來源」的抽象層**：`TaskPage.tsx` 是 39 段 hook 串起來的一個大 model，每個來源加自己一段一段的 hook（欄位用 `jira*`、`linear*` 前綴），畫面用寫死的 `taskSource === …` 三元判斷決定要畫哪個來源。
- Jira 在上游的份量：main 約 5,600 行（`src/main/jira/` 21 個檔），renderer 約 50 個 Jira 專屬檔，另外還要改約 90 個共用檔。
- 上游 lint 限制 `.ts` 檔 300 行、`.tsx` 檔 400 行（不算空行和註解），所以 Jira 拆得很碎；有幾個要加分支的上游檔已經接近上限，得先拆檔。

### 4.2 降低衝突的做法

照 T8，上游檔案只加「一行分支，呼叫 monday 自己的函式」，而且放在 Jira 分支旁邊。另外有三個刻意跟 Jira 不同的地方：

1. **狀態放在獨立的 zustand store**（`src/renderer/src/components/task-page/monday/monday-store.ts`），不併進 `AppState`。所以不用改 `store/index.ts`、`store/types.ts`，也不用把 monday 的 hook 插進 `TaskPage.tsx` 的 39 段 pipeline（插進去就得改下一段的型別）。清單、篩選、詳情、對話框的狀態都在這個 store，monday 的元件自己讀。
2. **Tasks 頁只加掛載點**：`task-page/Content.tsx` 加一行 `taskSource === 'monday'` 畫 `<MondayContent/>`（**一定要加**：沒有這行 monday 會掉進 Linear 的畫面）；`ProviderFilters.tsx`、`SourceBar.tsx` 各加一個分支。monday 的詳情抽屜和對話框掛在 `MondayContent` 裡面，不改 `Surface.tsx`。
3. **v1 不做的周邊一律不接**（§5.6）：這些地方只補「編譯要求」的最小分支（例如 automations 的 switch 回傳「不支援」），不做功能。

### 4.3 新增的檔案（全部 monday 專屬）

| 位置 | 內容 |
|---|---|
| `src/shared/monday/` | 型別（帳號、board、欄位、欄位對應、item、update、篩選）、網址解析（`/boards/<id>/pulses/<id>`，含 `/views/<id>/`）、欄位自動偵測（§4.5） |
| `src/main/monday/` | token 和帳號的儲存（T2）、GraphQL client（`getMainHttpClient()` 加 proxy，同時最多 4 個請求，錯誤對應 §4.6）、查詢（`me`、boards、board 結構、`items_page`／`next_items_page`、item 詳情、updates）、寫入（改欄位值、`create_update`、`create_item`）、欄位對應的儲存。**不 import `electron`**（跟 Jira 一樣，只有 IPC 那層會 import） |
| `src/main/ipc/monday.ts` | `monday:*` IPC channel（輸入用 zod 驗證；搜尋和清單可以取消，照 `jira-cancellable-requests.ts`） |
| `src/preload/api/monday-api.ts`、`monday-bridge.ts` | `window.api.monday` |
| `src/renderer/src/components/task-page/monday/` | 內容、篩選列、清單、詳情抽屜、建 item 對話框、連線對話框、store |
| `src/renderer/src/components/settings/monday-integration-card.tsx` | 設定頁 Integrations 卡片 |
| `src/renderer/src/components/icons/MondayIcon.tsx` | 圖示 |

### 4.4 要改的上游檔案（依 Phase 分）

標記：**[C]** 加了 `'monday'` 以後會編譯失敗，一定要改；**[S]** 會編譯過但行為錯（默默丟掉或當成別的來源），一定要改；**[O]** 功能需要才改。

**Phase 0（核心）**

- `src/shared/task-providers.ts`：`TaskProvider`、`TASK_PROVIDERS`；**[S]** `isTaskProviderAvailable` 對不認識的來源會回傳 `linearConnected`
- `src/shared/task-provider-identity.ts` **[C]**：加 `MondayTaskProviderIdentity { accountId, accountSlug, boardId }`，補上 3 個 switch 和 `TASK_PROVIDER_IDENTITY_FIELDS`
- `src/shared/task-source-context.ts` **[S]**：`normalizeTaskProvider` 的 `default: return null`
- 已經在用的設定檔看不到新來源（**[S]**，`normalizeVisibleTaskProviders` 會保留存好的清單）：照 Jira 的 `visibleTaskProvidersDefaultedForJira` 加一次性旗標 `…DefaultedForMonday`，要動 `global-settings-types.ts`、`default-global-settings.ts`、`normalize-loaded-global-settings.ts`、`prepare-loaded-profile-settings.ts`、`settings-update.ts`
- `src/shared/integration-credential-errors.ts` **[S]**：服務名稱清單
- `src/shared/feature-interaction-catalog.ts`、`feature-interaction-categories.ts`：`'monday-tasks'`
- `register-core-handlers.ts`、`preload/api-types.ts`、`preload/index.ts`：掛上 `monday`
- Renderer：`task-page/Content.tsx`、`ProviderFilters.tsx`、`SourceBar.tsx`、`task-page-localized-options.tsx`（`getSourceOptions`）、`use-task-page-source-availability.ts` **[S]**（`!== 'linear' && !== 'jira'` 會把 monday 當成 repo 型來源）、`use-task-page-source-summary.ts` **[S]**、`task-source-context-summary.ts` **[C]**、`task-page-list-chrome-visibility.ts` **[C]**、`use-task-page-repo-selection.ts`、`use-task-page-global-effects.ts`（Esc）、`use-task-page-search-actions.ts`（Cmd+F）、`worktree-nav-history.ts` 和 `worktree-nav-view-history-replay.ts` **[C]**（Linear 是最後的 else）
- 設定頁：`TasksPane.tsx` **[C]**（`PROVIDER_META`；**[S]** 設定步驟那段會給 monday 顯示 GitHub 的步驟）、`use-task-source-provider-readiness.ts` **[C]**、`TaskSourceSimpleSetup.tsx`、`task-provider-integration-section-ids.ts`、`IntegrationsPane.tsx`、`task-tracker-integration-cards.tsx`、`integrations-search.ts`、`tasks-search.ts`、`use-integration-provider-status-refresh.ts`
- Automations **[C]**：`automation-source-display.ts`、`automation-target-availability.ts` 的 switch 補 monday 分支（回傳「不支援」）；`automation-params.ts` 的 `z.enum` **不加** monday
- i18n：只加 `en.json` 和 `zh.json`，`zh-TW.json` 用 `generate-zh-tw-locale.mjs` 產生（不要手改）

**Phase 4（開工與連結）**

- `src/shared/worktree/types.ts` **[S]**：`WorkspaceLinkedItem.provider` 是另外寫死的 union；加 `mondayItemId?: string`、`mondayBoardId?: string`
- `src/shared/workspace-linked-item.ts` **[S]**：寫死的來源白名單，而且正規化時逐欄重建物件，**不認識的欄位會被刪掉**
- `src/shared/new-workspace/workspace-source.ts` **[S]**：`getWorkspaceSourceProvider` 會把 `number === 0` 又不是 GitHub 網址的 item 猜成 Linear；選取種類的三元判斷會把 monday 標成 `github-issue`；`shouldPreserveWorkspaceSourceOnRepoChange`
- `src/shared/workspace-name.ts` **[S]**：命名用 `linearIdentifier ?? jiraIdentifier`
- `ui-slice-contract-core.ts`：`NewWorkspaceDraft.linkedWorkItem.provider`
- `use-task-page-composer-actions.ts`：`openComposerForMondayItem`
- 開新 workspace 視窗：`hooks/composer-state/source-context-state.ts`、`derived-model.ts`
- worktree 卡片：`ui-chrome-types.ts` 的 `WorktreeCardProperty`、`card-properties.ts`（和它的一次性回填）、`worktree-card-display-property-options.ts`、`use-worktree-card-linked-details.ts`、`use-worktree-card-secondary-details.ts`、`worktree-card-meta-types.ts`、`WorktreeCardMetaBadges.tsx`、`WorktreeCardMeta.tsx`（接近行數上限，可能要先拆）、`worktree-card-title-display.ts`
- Cmd+J：`worktree-palette-task-url-match.ts`（接近行數上限；Jira 是最後的 fallthrough）、`PaletteCreateWorktreeRow.tsx`、`worktree-palette-evidence.ts`
- `SidebarTaskNavButton.tsx`：「開啟 monday 任務」

### 4.5 欄位自動偵測（T5）

依這兩個 board 的實際結構設計（2026-09-29 讀取）：

| 角色 | 「Omars's Task」 | 「Project Cases」 | 偵測規則 |
|---|---|---|---|
| 狀態 | `status`「Status」 | `status8`「Status」 | status 型別裡，標題是 Status／狀態的優先；排除標題是 Priority／優先的 |
| 負責人 | `multiple_person_mkq95a24`「使用者」 | `person`「Owner」 | 第一個 people 型別的欄位 |
| 到期日 | `date4`「Due Date」 | `date5`「Due Date」 | date 型別裡標題含 Due／到期的；沒有就不顯示 |
| 優先順序 | `status_1`「Priority」 | `status0`「Priority」 | 標題是 Priority／優先的 status 欄位 |
| 完成 | label 的 `is_done` | 同左 | 狀態欄 label 的 `is_done`；v1 不把「已完成」group 當成完成 |

每個 board 可以在篩選列的「欄位對應」選單手動改，存在 main 的 `~/.orca/monday-board-settings.json`（依帳號＋board）。

### 4.6 錯誤和限流

- **401**，或 GraphQL 錯誤是 `UserUnauthorizedException`：token 失效，要求重新連線（不自動刪 token）
- **`DAILY_LIMIT_EXCEEDED`**：顯示「今天的 monday API 額度（帳號共用）已用完，UTC 午夜重置」；不重試
- **每分鐘上限、`ComplexityException`、同時請求數上限**：照 `retry_in_seconds`／`Retry-After` 等待後自動重試一次，再失敗就顯示錯誤
- 其他 GraphQL 錯誤：顯示 monday 回的訊息
- 每個請求都帶 `complexity { query after }`，記在 debug log，用來觀察實際用量

## 5. 分階段實作

每個 Phase 做完：跑 typecheck（全部）、相關單元測試、lint、`check:code-quality:changed`，commit 到 `feat/monday`，再問使用者要不要合回 `omar/custom`。

### 5.0 Phase 0：連線，Tasks 頁出現 monday，board 清單（唯讀）

1. Phase 0 一開始先用使用者的 token 驗證 3 件事（只讀）：`assigned_to_me` 在 `query_params` 能不能用；目前 stable 的 `API-Version` 值；item `description` 欄位在這個版本拿不拿得到
2. `src/shared/monday/`：型別、網址解析、欄位偵測
3. `src/main/monday/`：token 儲存、client、`me`、boards 清單、board 結構、`items_page` 分頁；IPC 和 preload
4. §4.4 Phase 0 那一批上游檔案
5. Renderer：monday store；連線對話框（貼 token → 測試 → 儲存；說明 token 在哪裡拿）；設定頁卡片（帳號、測試、中斷連線）；Tasks 頁的 monday 內容：選 board，item 依 group 分區顯示（跟 monday 一樣），每列顯示名稱、狀態（label 顏色）、負責人、到期日；搜尋名稱；重新整理；在 monday 打開
6. 快取：清單 60 秒內重用，相同的請求進行中就共用；切換 board 時取消上一個請求

### 5.1 Phase 1：篩選、「指派給我」、欄位對應

- 篩選：group（多選）、狀態（多選）、負責人（我／全部／指定人）、「顯示已完成」（預設關）
- 「指派給我」模式：跨 board 列出指派給我的 item，依 board 再依 group 分區。要納入哪些 board 由使用者勾選（預設：最近用過而且有 people 欄的 board），一個請求最多 10 個 board（alias），超過就分批
- 欄位對應選單（§4.5）
- 模式、選的 board 和篩選記在 renderer 本機（`localStorage`），不放進上游的 `taskResumeState`（那個 schema 是 strict 的，新欄位會讓舊版主機丟掉整份狀態）

### 5.2 Phase 2：item 詳情

- 右側抽屜（跟 Jira 一樣 780px 的 Sheet）：名稱、board／group、「在 monday 打開」、「開工」（Phase 4 前先停用）
- 頂端列：狀態、負責人、到期日、優先順序
- 描述；所有欄位值（用 monday 的 `text`，不支援的型別顯示原文）；子項目清單（唯讀，可以點開）
- Updates 和回覆：HTML 用 `dompurify` 淨化後顯示；附件和圖片只顯示連結（monday 的檔案網址要登入，v1 不代抓）

### 5.3 Phase 3：寫入

- **改狀態**：詳情頂端列的狀態選單（label 和顏色照 board 設定），先在畫面上改好，失敗就還原並顯示錯誤；清單同步更新
- **發 update**：詳情下方的 markdown 輸入框 → `marked` 轉 HTML → `create_update`；每則 update 可以回覆（`parent_id`）；送出前可以預覽
- **建 item**：清單上方「新增 item」→ 對話框：board、group（預設 board 最上面的 group）、名稱、狀態、負責人（預設我）、到期日 → `create_item` → 打開新 item 的詳情
- 寫入後只重新讀取受影響的 item，不重新整理整個清單（省呼叫次數）

### 5.4 Phase 4：開工與連結

- 詳情和清單的「開工」→ 開新 workspace 視窗，名稱預設是 item 名稱（轉成分支名稱可用的形式），連結的 item 是 `{ provider: 'monday', type: 'issue', number: 0, title, url, mondayItemId, mondayBoardId }`
- 遠端 runtime 的 project（`runtime:*`）不附連結，並提示原因（T3）
- worktree 卡片：新的卡片屬性「monday item」，收合時顯示小標籤，滑過顯示名稱和「在 monday 查看」；卡片標題的 fallback 順序加上 monday
- Cmd+J：貼 monday 網址 → 找已連結這個 item 的 worktree；沒有就提供「從這個 item 開工」
- 側邊欄的任務按鈕加「開啟 monday 任務」
- §4.4 Phase 4 那一批上游檔案

### 5.5 Phase 5（v1 做完再決定）

- 開新 workspace 視窗的名稱欄搜尋 monday item（smart name field，約 20 個上游檔案）
- Automations 用 monday 當來源
- 遠端 runtime 的 RPC（`MONDAY_METHODS`，要加 capability flag，因為舊版伺服器會拒絕 `'monday'`）和手機
- CLI

### 5.6 刻意不做

Feature wall、setup guide 的 monday 項目；monday 的 webhook（桌面 app 收不到）；背景輪詢（T4）；monday 文件（docs）；看板以外的 view（timeline、calendar）。

## 6. 測試

- **單元測試**（假的 monday 回應）：網址解析、欄位偵測（用 §4.5 兩個 board 的實際結構當 fixture）、錯誤對應和重試（每日上限不重試、每分鐘上限等 `retry_in_seconds`）、token 儲存（加密不可用時不寫檔）、`workspace-linked-item` 正規化保留 monday 欄位、`visibleTaskProviders` 一次性遷移、monday store 的快取和取消、markdown 轉 HTML
- **上游的全域測試**：`task-page-source-family`（會自動掃到新的 `task-page-*` 檔）、`task-page-task-creation-drafts`（寫死草稿寫入者的數量，v1 建 item 不做草稿保留）、rpc params catalog、localization 檢查
- **e2e**：用本機的假 monday GraphQL 伺服器，只在 e2e 模式讓 client 改用它的網址（正式版不能改 endpoint）。案例：連線、選 board、篩選、詳情、改狀態、發 update、建 item、開工後卡片出現連結、Cmd+J 貼網址。e2e 要加 `--lang=en-US`（這台 Mac 是 zh-TW）
- **真實帳號**：只讀的驗證（Phase 0 第 1 步）用使用者的 token。**寫入類的真實測試要先問使用者**，並且只在使用者指定的測試 board 上做，不碰「Omars's Task」和「Project Cases」

## 7. 風險和未決事項

| 風險 | 說明 | 對策 |
|---|---|---|
| 同步上游的衝突 | 約 80–90 個上游檔案（Phase 0 約 40 個，Phase 4 約 25 個），Tasks 頁、worktree 卡片、Cmd+J 是上游常改的地方 | §4.2：分支一行、放在 Jira 旁邊、狀態放獨立 store。同步時衝突多半是「兩邊各加一個分支」，照上游的新寫法重新加上 monday 那行 |
| 每日呼叫上限 | 帳號共用 10,000 次／天 | T4；預估正常使用一天幾百次以內；錯誤訊息講清楚是帳號共用額度 |
| `assigned_to_me` 可能不能用在 `query_params` | monday 兩份文件說法不同 | Phase 0 實測；不行就改用 `items_page_by_column_values`（一次一個 board，「指派給我」的呼叫次數會變多） |
| API 版本淘汰 | monday 每季出版本，舊版會停用 | 版本寫成一個常數；停用前換版本並跑 e2e |
| 行數上限 | 要加分支的幾個上游檔已經接近 300／400 行 | 先把要改的那段拆到新檔（新檔是 fork 的，但拆檔本身也會跟上游衝突，拆得越小越好） |
| Token 權限 | personal token 有使用者自己的全部權限，寫入會以使用者本人名義出現 | 寫入都要使用者在 UI 上明確操作；token 只在 main |
