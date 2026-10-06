# ngrok 管理（fork 專屬）

> 狀態：已完成（2026-10-06）
> 對象：接手維護的人或新對話。本文件可獨立閱讀。

## 1. 使用者看到的功能

| 位置                                                       | 行為                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 狀態列 **Ports** popover 的每個本機 port                   | hover 時的動作按鈕多一個「用 ngrok 公開分享」；分享後該列多一行公開網址（點了用系統瀏覽器開）。再按一次同一顆按鈕就停止分享                                                                                                  |
| Ports popover 的 **ngrok** 區塊                            | 列出這台機器上**所有** ngrok endpoint：Orca 自己開的，以及你在終端機手動跑的 `ngrok http …`／`ngrok start …`。每列可開啟、複製、看 inspector（請求紀錄）、停止。區塊標題列可開 Orca agent 的 inspector，或停掉 Orca 的 agent |
| SSH 工作區（右側欄 Ports 面板，只有 SSH 工作區有這個分頁） | Forwarded ports 可以分享，分享的是 forward 在本機的那一端（`localhost:<localPort>`）；面板底部有同樣的 ngrok 區塊                                                                                                            |
| Run／Debug 面板標題列                                      | port 按鈕旁有分享按鈕；分享後顯示公開網址，旁邊有停止按鈕                                                                                                                                                                    |
| 右上角 Run widget（精簡）                                  | 只在已分享時顯示一個圖示，點了開公開網址                                                                                                                                                                                     |
| Edit Configurations（command、debug 設定）                 | 「執行時用 ngrok 公開分享」＋選填 port。程式開始監聽後自動分享（網址自動複製），停止執行時一併關閉                                                                                                                           |

`orca.yaml` 寫法：`ngrok: true`（分享它開的最小 port）或 `ngrok: { port: 5016 }`。

**固定網址先到先得**：分享任何 port 時，ngrok.yml 裡同 port 的 endpoint 優先；沒有的話，只要設定檔裡有固定網址目前沒被任何 agent 用著（Orca 的，或終端機手動跑的），就借給這個 port（帶著那筆的 `traffic_policy`，upstream 換成這個 port，名稱用 `orca-<port>`）；都被占用了才用隨機網址。ngrok 回 `ERR_NGROK_334`（網址在 Orca 看不到的地方上線，例如另一台電腦）時，自動退回隨機網址。分享按鈕的提示跟 main 用同一個判斷（`src/shared/ngrok/ngrok-reserved-url.ts`），所以會照實寫出這次會拿到哪個網址。Run 設定的自動分享也一樣：先跑起來的拿到固定網址。

**ngrok.yml 的具名 endpoint**（等同 `ngrok start <名稱>`）：NGROK 區塊會把設定檔裡還沒上線的 endpoint 列成「ngrok.yml · 名稱 · 未啟動」，按 ▶ 就能啟動。分享某個 port 時，如果 ngrok.yml 有 upstream 是同一個 port 的 endpoint，就改用它，連同它的固定網址（例如 dev domain）；分享按鈕的提示會寫成「分享到 <網域>（ngrok.yml）」。設定檔路徑交給 `ngrok config check` 解析，所以規則跟 ngrok 自己完全一致。`endpoints:`（v3）和 `tunnels:`（舊格式，只取 http）兩種格式都支援。解析時只取 endpoint 定義需要的欄位，設定檔裡的 authtoken 絕不會離開 main process。

## 2. 架構

```
Renderer                                   Main                               本機
ngrok-store（快照、分享／停止） ── IPC ──► NgrokService ─┬─ NgrokManagedAgent ─► `ngrok start --none --log stdout --log-format json`
ngrok-run-auto-share（Run 設定）                         └─ ngrok-agent-api ──► 各 agent 的本機 API（127.0.0.1:4040…）
```

- **一個 Orca 自己的 agent**：第一次分享時才啟動 `ngrok start --none`，之後透過它的本機 API（`POST/DELETE /api/endpoints`）加減 endpoint。最後一個 endpoint 停掉、或第一次分享失敗時，就把 agent 關掉，因為閒置的 agent 仍然占用帳號的同時 session 額度。Orca 結束時（`will-quit`）也會關掉。
- **web API 位址**從 agent 的 JSON log `starting web service`（`addr`）讀出。4040 被占用時，ngrok 會自己改用 4041、4042…；`client session established` 才算就緒。`lvl: crit` 或 `terminating with error` 視為啟動失敗，錯誤訊息取第一行再加上 `ERR_NGROK_xxxx`。
- **外部 agent 偵測**：renderer 從本機 port 掃描結果裡挑出 process 名稱是 `ngrok`／`ngrok.exe` 的 listener，把它們的 port 交給 main 去問 `/api/endpoints`（舊版 agent 改問 `/api/tunnels`），回應用 zod 驗證。只看 process 名稱，所以**不會對別人的 dev server 發請求**。
- **回應格式不一致**（3.39.6 實測）：GET `/api/endpoints` 是 endpoint 格式（`url`、`upstream.url`），POST 卻回 tunnel 格式（`public_url`、`config.addr`），兩種都要解析。
- **安全**：分享的 upstream 只接受 loopback（`localhost`／`127.0.0.1`／`::1`，wildcard bind 一律當 `localhost`）。main 只對 loopback 位址的 agent 呼叫 API。ngrok 自己的 inspector port 不能被分享。
- **名稱**：Orca 開的 endpoint 一律叫 `orca-<port>`；用 ngrok.yml 定義開的則沿用設定檔裡的名稱。同一個名稱再分享一次，會沿用既有的 endpoint。終端機 `ngrok start 5016` 開的 endpoint，名稱或網址只要跟設定檔相同，就算「已上線」。

## 3. Run 設定自動分享

`ngrok-run-auto-share-plan.ts`（純函式）＋ `ngrok-run-auto-share.ts`（訂閱 store）：

- session 對應設定：run 用 `commandKey`、debug 用 `sourceKey`，兩者都是 `config:<id>`。
- 每個 session **attempt** 只分享一次。分享失敗或使用者手動停止，同一次執行內都不會再試；Rerun 會產生新的 attempt。
- port 已經有人分享時，直接沿用（renderer reload 後不會重複分享）。如果那是外部 agent 的 endpoint，執行結束時**不會**去停它。
- 只處理 runtime target 是本機的工作區，因為 Orca 的 agent 連不到其他 host 的 loopback。

## 4. 限制

- 免費方案：只有 1 個 dev domain、同時最多 3 個 endpoint、3 個 agent session。不指定 url 時，ngrok 會給隨機的 `*.ngrok-free.app` 網址；dev domain 已經被其他 endpoint 占用時會回 `ERR_NGROK_334`，Orca 原樣顯示這個錯誤。
- 遠端 runtime（非本機、非 SSH forward）的 port 不提供分享。
- 沒有 authtoken 時，啟動會失敗（`ERR_NGROK_4018`），錯誤會顯示在 ngrok 區塊。需要先在終端機跑一次 `ngrok config add-authtoken <token>`。
- 找不到 ngrok 時整個功能隱藏。可以用 `ORCA_NGROK_PATH` 指定 binary（E2E 也是靠它換成假的 agent）。

## 5. 測試

- 單元測試：`src/main/ngrok/*.test.ts`（以真實 log 行與一個假的 agent HTTP server 驗證）、`src/shared/ngrok/ngrok-types.test.ts`、`src/renderer/src/components/ngrok/*.test.ts`、`run-configuration-definition.test.ts`。
- E2E：`tests/e2e/ngrok-sharing.spec.ts`，透過 `ORCA_NGROK_PATH` 指向一支假的 ngrok（Node 腳本），不會產生真的公開網址。系統瀏覽器與剪貼簿都在 main 端 stub 掉。
