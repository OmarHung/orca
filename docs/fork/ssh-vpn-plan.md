# SSH／SFTP 自動走 OpenVPN：實作計畫（fork 專屬）

> 狀態：全部完成（2026-09-29），含帳密登入；紀錄見 §9，使用說明與已知限制見 §10
> 分支：`feat/ssh-vpn`（worktree `/Users/omar/myprojects/orca-worktrees/feat-ssh-vpn`），每個 Phase 完成後合回 `omar/custom`
> 對象：接手實作的人或新對話。本文件可獨立閱讀，不需要先前的對話紀錄。

## 1. 目標

某些 SSH 主機只能透過公司的 OpenVPN 連到。現在的做法是整台 Mac 連上 OpenVPN Connect，所有流量都會跟著走 VPN。

目標：**在 Orca 裡把主機指定給某個 VPN 設定檔（.ovpn），之後連這台主機時，Orca 自動把 VPN 連上，而且只有這條連線走 VPN。Mac 本身的網路維持不走 VPN。**

要涵蓋的連線：

| 功能 | 連線方式 | 走 VPN 的方法 |
|---|---|---|
| SSH 頁的終端機分頁 | 本機 PTY 執行系統 `ssh <別名>` | 指令加上 `-o ProxyCommand=…` |
| SFTP 頁 | main process 的 ssh2（`SshConnection`） | 把 ssh2 的 `config.sock` 換成 VPN 通道 |
| 資料庫的 SSH 通道 | 同上（`DatabaseSshConnections`） | 同上 |
| 設定頁「連線」（relay 工作區、port forward） | 同上 | 同上 |
| 必須走系統 ssh 的主機（FIDO2 金鑰、GSSAPI） | `buildSshArgs` 產生的系統 ssh | 參數加上 `-o ProxyCommand=…` |

## 2. 已確定的決策（使用者，2026-09-29）

| # | 決策 | 內容 |
|---|---|---|
| D1 | 做法 | 方案 C：做進 Orca，連線時自動啟動 VPN |
| D2 | VPN 登入方式 | 原本只支援憑證。**2026-09-29 使用者要求加做帳密登入**（見 §9）；MFA、SSO 仍不在範圍 |
| D3 | 設定位置 | **SSH 頁和設定頁兩邊都能設定**：兩邊都能管理 VPN 設定檔，也都能指定主機要用哪個 VPN |
| D4 | 斷線時機 | **閒置 10 分鐘自動斷**：沒有任何連線在用這個 VPN 時開始計時。分鐘數可以依設定檔調整，設成 0 代表不自動斷。關閉 Orca 時一定會斷 |
| D5 | 降低 upstream 衝突 | 新程式碼放在新目錄；對 upstream 檔案只加掛載點。i18n 用 fork 自己的 namespace `sshVpn.*` |

## 3. 現有架構（2026-09-29 調查結果）

路徑都相對於 `src/`。

### 3.1 為什麼不能直接用「Proxy Command」欄位

主機設定已經有 Proxy Command 欄位，但只要設了 ProxyCommand 或 ProxyJump，`shouldUseSystemSshTransport()`（`main/ssh/ssh-transport-selection.ts:71`）就會讓連線改走系統 `ssh`。SFTP 頁遇到走系統 ssh 的主機會直接拒絕（`main/sftp/sftp-session-manager.ts:45` 的 `SYSTEM_TRANSPORT_MESSAGE`）。

所以 VPN **不能**做成 ProxyCommand 字串塞進主機設定，而是要另外處理：ssh2 路徑直接換 `config.sock`，不影響選擇哪種連線方式。

### 3.2 可重用的東西

- `main/ssh/ssh-proxy-command.ts` 的 `spawnProxyCommand()`：把子程序的 stdin／stdout 包成 ssh2 可用的 `Duplex`，已經處理 backpressure、stderr 排空和錯誤。`jump-host` 分支示範了怎麼用 `spawnProcess` 直接執行、不經 shell。VPN 通道新增一種 `EffectiveProxy`（argv 形式），沿用同一套包裝。
- `main/ssh/ssh-connection.ts:830` 附近：ssh2 路徑設定 `config.sock` 的位置，就是 VPN 的掛載點。
- `main/ssh/system-ssh-args.ts` 的 `buildSshArgs()`：所有系統 ssh 的呼叫都經過它（`system-ssh-command.ts`、`system-ssh-forward-process.ts`、`system-ssh-dynamic-forward-process.ts`、`system-ssh-file-transfer.ts`、`system-ssh-sftp-transfer.ts`），第 98 行已經有注入 `-o ProxyCommand=` 的寫法。
- `renderer/.../ssh-page/ssh-session-command.ts` 的 `buildSshSessionCommand()` 和 `ssh-session-actions.ts` 的 `openSshSession()`：SSH 頁開分頁前會跳出確認對話框，列出確切的指令（commit `81aec0bf04`）。
- `shared/child-process/` 的 `spawnProcess`：Windows 上必須用它來啟動子程序（AGENTS.md 規定）。

### 3.3 可行性實測（2026-09-29，這台 Mac，Docker 29.8.1 linux/arm64）

- `alpine:3.22` 加上 `--cap-add NET_ADMIN --device /dev/net/tun` 後，可以 `apk add openvpn` 裝到 **OpenVPN 2.6.20**，容器裡也有 `/dev/net/tun`。
- Alpine 內建 BusyBox 的 `nc`。`docker exec -i <容器> nc github.com 22` 可以收到 `SSH-2.0-…` banner，證明 `docker exec … nc` 可以當 SSH 的傳輸通道。

## 4. 設計

### 4.1 整體架構

```
Mac 本機網路（不變）
│
├─ Orca main ──ssh2 sock──► docker exec -i <容器> nc <host> <port> ─┐
├─ SSH 頁 PTY: ssh -o ProxyCommand="docker exec -i <容器> nc %h %p" ─┤
│                                                                   ▼
│                                  Docker VM 內的容器：OpenVPN（tun0）──► 公司內網主機
└─ 其他所有程式 ──► 一般網路
```

- 一個 VPN 設定檔對應一個容器，多台主機可以共用同一個 VPN。
- **不開任何 port**：通道是 `docker exec` 的 stdin／stdout，本機其他程式和區網上的人都用不到這條 VPN。
- DNS 在容器裡解析，所以只有 VPN 內部 DNS 認得的主機名稱也能連。

### 4.2 映像檔

- 第一次使用時，用 `docker build -t orca-ssh-vpn:<內容雜湊> -` 在本機建置。Dockerfile 從 stdin 傳入，**不用第三方映像檔**。
- 內容：`FROM alpine:3.22@sha256:<固定 digest>`，`apk add --no-cache openvpn`，再加一支 DNS 用的 up script（見 4.4）。
- 建置需要連網一次（抓 alpine 和 apk 套件）。之後就算離線，只要映像檔還在就能用。Dockerfile 內容一變，雜湊標籤就會跟著變，自動重建。

### 4.3 容器生命週期

由 main 的 `SshVpnManager` 管理。狀態：`stopped` → `starting` → `ready` → `stopping`，另外有 `error`（保留最後幾行日誌）。

**啟動**（多條連線同時要求時，只啟動一次）：

1. 解析 docker 的絕對路徑，執行 `docker info` 確認 Docker 在跑。沒安裝或沒啟動時，直接顯示明確的錯誤訊息。
2. 確認映像檔存在，不存在就建置。
3. 執行：
   ```
   docker run -d --rm --name orca-ssh-vpn-<instance>-<profile8>
     --label dev.orca.ssh-vpn.instance=<instance> --label dev.orca.ssh-vpn.profile=<id>
     --cap-add NET_ADMIN --device /dev/net/tun
     --tmpfs /run/orca:rw,mode=0700
     orca-ssh-vpn:<hash> <常駐的空閒程序>
   ```
   `<instance>` 是 userData 路徑的雜湊，讓 dev 版和正式版的 Orca 各自管理自己的容器，不會互相刪除。
4. 用 `docker exec -i <容器> sh -c 'cat > /run/orca/<檔名>'` 把 .ovpn 和它引用的檔案寫進容器內的 tmpfs（記憶體檔案系統，不落地）。`docker cp` 不能寫進 tmpfs，所以不用它。
5. `docker exec -i <容器> openvpn --config /run/orca/profile.ovpn --cd /run/orca --script-security 2 --up <dns script> --verb 3`，main 持續讀取它的輸出：
   - 看到 `Initialization Sequence Completed` → `ready`
   - `AUTH_FAILED`、`Exiting due to fatal error`、程序結束，或 60 秒逾時 → `error`，並移除容器

**閒置斷線（D4）**：狀態是 `ready` 時，每 60 秒執行一次 `docker exec <容器> pgrep -x nc`。每條走 VPN 的連線都是容器裡的一個 `nc`，所以這個數量就是使用中的連線數，不管連線來自 ssh2、SSH 頁終端機還是系統 ssh 都算得到。數量連續為 0 超過設定的分鐘數（預設 10，0 代表不自動斷）就執行 `docker rm -f`。

**清理**：
- Orca 關閉前：對自己 instance 的所有容器執行 `docker rm -f`（最多等 3 秒）。
- Orca 啟動時：清掉上次當機留下、同一個 instance 的容器。

### 4.4 DNS

容器裡的 OpenVPN 預設不會改 `/etc/resolv.conf`。映像檔內建一支 up script，讀取 OpenVPN 傳入的 `foreign_option_*` 環境變數，把推送下來的 `dhcp-option DNS` 和 `DOMAIN` 寫進容器的 `/etc/resolv.conf`。命令列的 `--up` 放在 `--config` 之後，所以會取代 .ovpn 自己的 `up` 設定。

### 4.5 .ovpn 解析

新增設定檔時和每次連線前都會解析：

- **引用外部檔案**的指令（`ca`、`cert`、`key`、`tls-auth`、`tls-crypt`、`tls-crypt-v2`、`pkcs12`、`crl-verify`、`extra-certs`、`secret`，不含 `[inline]`）：把相對於 .ovpn 所在目錄的檔案一起寫進容器。找不到檔案就在連線前報錯。
- **第一版不支援、要明確報錯**的指令：`auth-user-pass`（D2）、`static-challenge`（MFA）、加密的私鑰（需要 askpass）。
- 其他指令原封不動交給 OpenVPN。OpenVPN Connect 專用的指令如果 2.6 版不認得，錯誤會出現在日誌裡。

設定檔只存 .ovpn 的**路徑**，每次連線時才讀取，跟 SSH 的 identityFile 一樣。.ovpn 通常內含私鑰，這樣做可以避免 Orca 再多存一份秘密。

### 4.6 儲存

fork 自己的檔案 `<userData>/ssh-vpn.json`：

```ts
type SshVpnProfile = { id: string; name: string; ovpnPath: string; idleMinutes: number }
type SshVpnState = { profiles: SshVpnProfile[]; assignments: Record<string /* SshTarget.id */, string /* profile id */> }
```

- 不在 upstream 的 `SshTarget` 型別加欄位。這樣從 `~/.ssh/config` 重新匯入主機時不會洗掉指派，upstream 的 IPC schema 也不用改。
- 主機被刪除後，下次載入時自動清掉失效的指派。
- 沒有任何 RPC 或 wire 變更（見 AGENTS.md「Remote Wire Compatibility」）。

### 4.7 連線掛載點（upstream 檔案，都只是幾行）

1. **`ssh-proxy-command.ts`**：`EffectiveProxy` 新增 `{ kind: 'argv'; program; args }`，用 `spawnProcess` 執行，沿用既有的 Duplex 包裝。
2. **`ssh-connection.ts`**：`doConnect` 一開始就呼叫 fork 的 `prepareSshVpnRoute(target, resolved)`：
   - 主機沒有指定 VPN → 回傳 `null`，行為完全不變。
   - 有指定 → 等 VPN `ready`，再回傳 argv proxy：`docker exec -i <容器> nc <host> <port>`，ssh2 路徑就用它取代 `resolveEffectiveProxy`。
3. **`system-ssh-args.ts`**：`buildSshArgs` 呼叫 fork 的 `getSshVpnProxyCommand(target)`，有值就加上 `-o ProxyCommand=<docker 絕對路徑> exec -i <容器> nc %h %p`。
4. **失敗時一律不連線（fail closed）**：主機指定了 VPN，但 VPN 沒有 `ready` 時，一律報錯，**絕不**直接連線。否則連線可能不經 VPN 就從一般網路出去。
5. **衝突**：主機（或它的 `~/.ssh/config`）已經有 ProxyCommand 或 ProxyJump 時，第一版直接報錯，說明兩者不能並用。原因：OpenSSH 的 `-o ProxyCommand` 會蓋掉 ProxyJump，連線路線會在使用者不知情的情況下改變。

### 4.8 UI

**SSH 頁**（fork 檔案）：
- 主機清單上方加一個「VPN」按鈕，用顏色標示狀態（未連線／連線中／已連線／錯誤）。點下去打開 VPN 面板：列出設定檔和狀態，可以新增、編輯、刪除、手動連線和斷線，也可以看最近的日誌。
- 主機清單加右鍵選單「VPN」，子選單列出「不使用」和各個設定檔。有指定 VPN 的主機顯示一個小標記。
- 開 SSH 分頁時，確認對話框的指令清單會加上 VPN 的 `docker …` 指令（VPN 還沒連上時才列），ssh 指令則顯示含 `-o ProxyCommand=…` 的完整版本。按下「連線」後，**先等 VPN `ready`，才把 ssh 指令送進終端機**。

**設定頁**（掛載 fork 元件到 upstream 檔案）：
- `SshPane.tsx`：加入「VPN 設定檔」區塊，跟 SSH 頁的 VPN 面板共用同一套管理元件。
- `SshHostAdvancedFields.tsx`：主機表單加上「VPN」下拉選單。按「儲存」時一起寫入；新增主機時，拿到新主機的 id 之後才寫入指派。

**確認對話框**：沿用 `81aec0bf04`「每個 SSH／SFTP 動作都先列出確切指令」的原則。
- SSH 頁由 renderer 發起連線，確認對話框本來就有，把 VPN 指令併進去即可。
- SFTP、資料庫、relay 由 main 發起連線。要啟動 VPN 時，main 請 renderer 跳出確認對話框，列出 docker 指令。使用者拒絕的話，連線失敗並顯示「VPN 未啟動」。
- 確認只在 VPN **啟動**時跳出，VPN 已經連上時，新的連線不會再問。

### 4.9 跨平台

- macOS（Docker Desktop、OrbStack、Colima）和 Windows（Docker Desktop／WSL2）：容器跑在 Docker 的 VM 裡。Linux 的 Docker Engine 直接跑在主機上，但容器有自己的網路 namespace，主機網路一樣不受影響。
- docker 一律用解析好的絕對路徑，因為從 GUI 啟動的 Orca，PATH 可能找不到它。
- SSH 頁送進終端機的 `-o "ProxyCommand=…"` 要依 shell 處理引號：POSIX shell、fish、PowerShell、cmd.exe 各不相同。另外要處理 Windows 的 docker 路徑含空白（`C:\Program Files\…`）的情況。
- 開發和驗證只在這台 Mac 上做，Windows 和 Linux 只有單元測試覆蓋。

## 5. 安全性

- VPN 通道不開 port，只有 Orca 透過 `docker exec` 能用。
- .ovpn 和引用的金鑰只存在容器內的 tmpfs，容器移除後就消失，不會出現在 `docker inspect`、指令參數或環境變數裡。
- .ovpn 裡的 `up`／`down` 等 script 只會在容器裡執行，碰不到 Mac。
- 映像檔在本機建置，alpine 用 digest 固定版本，不依賴第三方映像檔。
- fail closed（4.7 第 4 點）：指定了 VPN 的主機，絕不在沒有 VPN 的情況下連線。

## 6. 第一版不做

- 帳密、MFA／動態驗證碼、SSO／SAML 登入（D2）。解析到相關指令時明確報錯。
- VPN 和 ProxyJump／ProxyCommand 並用（4.7 第 5 點）。之後可以做成「先走 VPN，再跳板」。
- Podman 和 rootless Docker。
- 手機版和 web 客戶端。VPN 跑在發起 SSH 連線的那台桌機上。

## 7. 分階段

每個 Phase 完成都要跑 `tc`、單元測試和 `check:code-quality:changed`，合回 `omar/custom` 前先給使用者確認。

### Phase 0：核心和測試環境（只有 main，沒有 UI）——已完成

- `src/main/ssh-vpn/`：docker 指令產生與執行、映像檔建置、`SshVpnManager`（狀態機、同時啟動只跑一次、就緒判斷、閒置斷線、清理）、.ovpn 解析、`ssh-vpn.json` 存取。
- 連線掛載點：4.7 的 1～4 點，以及第 5 點的衝突檢查。
- **測試環境**：用 Docker 建一個只有 VPN 才進得去的內網。一個 OpenVPN server 容器（測試用 PKI 在測試開始時產生），加上一個只接在 `--internal` 網路上的 sshd。用 `ORCA_TEST_SSH_VPN_DOCKER=1` 開關。
- 驗收：
  - 整合測試：`SshConnection` 和 `SftpSessionManager` 在 VPN 下可以連到內網 sshd，不走 VPN 時連不到。
  - Mac 的網卡和路由表在測試前後沒有變化。
  - VPN 啟動失敗時，連線一定失敗（fail closed）。
  - 單元測試：指令產生、日誌判斷、.ovpn 解析、閒置計時、同時啟動。

### Phase 1：SSH 頁、SFTP 頁與確認流程——已完成

- SSH 頁的 VPN 按鈕和面板、主機右鍵選單、主機標記。
- SSH 分頁：確認對話框加入 VPN 指令，等 VPN 就緒後才送出含 ProxyCommand 的 ssh 指令。
- main 發起 VPN 啟動時的確認流程（SFTP、資料庫、relay）。
- Docker 沒安裝或沒啟動時的提示。
- i18n：只加 `en.json` 和 `zh.json`，再跑 `generate-zh-tw-locale.mjs` 產生 zh-TW。
- 驗收：e2e 測試用 SSH 頁開分頁到內網 sshd、用 SFTP 頁列出內網主機的目錄。另外給使用者在 `pnpm dev` 用自己的 .ovpn 實際試用。

### Phase 2：設定頁——已完成

- `SshPane` 加入「VPN 設定檔」區塊。
- 主機表單加入 VPN 下拉選單，包含新增主機時的寫入流程。
- 驗收：兩邊設定的結果一致（在一邊改，另一邊馬上看得到）。

### Phase 3：收尾——已完成

- 設定檔可以調整閒置分鐘數，並驗證關閉 Orca 時和當機後重開的清理。
- 在 `docs/fork/` 補上使用說明與已知限制，用 fork build script 打包給使用者安裝。

## 8. 風險

| 風險 | 影響 | 處理 |
|---|---|---|
| Docker 沒啟動 | VPN 連不上 | 明確提示；macOS 可以提供「啟動 Docker」按鈕 |
| 第一次連線比較慢 | 建置映像檔約數十秒（只有一次）；容器啟動加 VPN 握手約 3～10 秒 | 顯示進度；閒置 10 分鐘才斷，同一段時間內的連線都不用重新等 |
| 每條連線多一次 `docker exec` | 建立連線時多約 0.1～0.3 秒 | 可以接受，連上之後的傳輸不受影響 |
| OpenVPN Connect 專用的指令 | OpenVPN 2.6 可能不認得 | 把日誌給使用者看；必要時在解析階段忽略已知無害的指令 |
| Docker Desktop 的商業授權 | 公司規定可能不能用 | OrbStack 和 Colima 都相容 docker CLI |

## 9. 進度紀錄

### Phase 0（2026-09-29，分支 `feat/ssh-vpn`）

**新檔案**（`src/main/ssh-vpn/`，另有 `src/shared/ssh-vpn-types.ts`）：

| 檔案 | 內容 |
|---|---|
| `ovpn-profile-preparation.ts` | 解析 .ovpn：複製引用的檔案並改寫路徑、拿掉 `daemon`／`log`／`up` 等指令、拒絕帳密／MFA／加密私鑰（4.5） |
| `openvpn-output.ts` | 判斷 OpenVPN 輸出（就緒、失敗）、取失敗原因、保留最後 40 行日誌 |
| `ssh-vpn-image.ts` | 內建 Dockerfile（alpine digest 固定）與 DNS up script，標籤是內容雜湊 |
| `ssh-vpn-docker.ts` | docker 路徑解析、所有 argv 產生器、`SshVpnDocker`（只用 argv，不經 shell）、系統 ssh 的 ProxyCommand 字串 |
| `ssh-vpn-manager.ts` | 每個設定檔一個容器的狀態機：同時啟動只跑一次、60 秒就緒逾時、OpenVPN 掉線、閒置斷線、清理 |
| `ssh-vpn-store.ts` | `userData/ssh-vpn.json`（設定檔＋主機指派） |
| `ssh-vpn-route.ts` | upstream 掛載點用的 seam（沒有 runtime import，避免循環相依） |
| `ssh-vpn-service.ts` | 查主機的 VPN、衝突檢查、回傳 argv proxy／ProxyCommand、fail closed |
| `ssh-vpn-ipc.ts` | 啟動註冊：設定 provider、有設定檔時清理殘留容器、`will-quit` 時同步 `docker rm -f` |
| `ssh-vpn-test-network.ts` | 測試專用：只有 VPN 進得去的 Docker 內網 |

**upstream 掛載點**（共約 30 行）：`ssh-proxy-command.ts`（新增 `argv` 類型）、`ssh-connection.ts`（`attemptConnect` 一開始呼叫 `prepareSshVpnRoute`）、`system-ssh-args.ts`（`buildSshArgs` 注入 ProxyCommand）、`register-core-handlers.ts`（註冊）及其測試的 mock。

**驗證**：
- 單元測試 48 個（含 upstream 掛載點：argv proxy 不經 shell、ssh2 拿到 VPN 的 sock、VPN 起不來時不建立 ssh2 連線、`buildSshArgs` 在 VPN 沒連上時丟錯）。
- 既有的 SSH／SFTP／資料庫 SSH／core handler 測試 2512 個全過。
- Docker 整合測試（`ORCA_TEST_SSH_VPN_DOCKER=1`，約 6 秒）5 個全過：沒 VPN 連不到內網 sshd；ssh2 經由 VPN 執行指令和 SFTP，而且是用**只有 VPN 內部 DNS 才認得的名稱**連線；系統 `ssh` 用 Orca 產生的 ProxyCommand 連得上；Mac 的網路介面前後一樣；停止後容器消失、系統 ssh 拒絕連線。刪掉映像檔重跑，驗證了第一次使用時自動建置。

```
ORCA_TEST_SSH_VPN_DOCKER=1 node_modules/.bin/vitest run --config config/vitest.config.ts src/main/ssh-vpn/ssh-vpn-docker.integration.test.ts
```

**實作時發現／決定**：
- VPN 服務在 `registerCoreHandlers` 註冊，比 SSH 啟動時的自動重連早。`orca serve`（沒有視窗的模式）不會註冊，所以該模式下主機的 VPN 指派不生效：只能經 VPN 連到的主機會連不上，而本來就能直連的主機會直接連線、不經 VPN。**Phase 3 要補上**：serve 模式也要註冊，或在沒註冊時對有指派的主機一律拒絕連線。
- 系統 ssh 的 ControlMaster（`ControlPersist=300`）：如果主機在指派 VPN 之前已經有一條 master 連線，接下來 5 分鐘內的指令可能沿用那條舊連線。影響很小（那條連線本來就能直連），先記錄不處理。
- 測試伺服器用 dnsmasq 的 `--address=` 時，AAAA 查詢會回 REFUSED，musl 的解析器就會整個失敗；改用 `--host-record` 加 `--local` 就正常。真實的公司 DNS 通常不會這樣回應，但如果使用者遇到「用 IP 可以、用名稱不行」，可以往這個方向查。

### Phase 0 之後的修正（2026-09-29）

用使用者的 `taipei.ovpn` 在 dev 實測時發現：
- **容器裡的 `nc` 殘留**：`docker exec` 的 client 被殺掉時，容器裡的 `nc` 不會跟著結束。連不到的主機每次重試都會留下一個卡在 connect 的 `nc`，閒置計數永遠不會歸零。改成 `nc -w 30`（只限制建立連線；已實測，已連上的閒置連線不受影響）。修正後，閒置 10 分鐘自動中斷連線在 dev 實際生效。
- 實測結果：taipei VPN 本身正常（容器出口 IP 跟 Mac 不同，Mac 的網路不變），但 FC-Beta 的防火牆沒有放行 taipei 的出口 IP，所以連不上。使用者的其他 .ovpn（例如「豐田固定ip」、asuscomm）都需要帳密，第一版不支援。
- `ssh-vpn.json` 改成檔案 mtime 變了就重新讀取，手動編輯不用重開。

### Phase 1（2026-09-29）

**確認流程（跟 §4.8 的差異）**：改成「**每次啟動 VPN 都由 main 請 renderer 確認**」，SSH 頁、SFTP 頁、資料庫、relay、手動連線都走同一套，不再由 SSH 頁自己組 VPN 指令。
- main：`SshVpnManager.acquire(profile, { confirm })` 在實際動作前，先用 `sshVpnStartCommands()` 列出每一條 docker 指令（跟實際執行的 argv 同一來源）。使用者拒絕、沒有視窗、5 分鐘沒回應都不啟動；排在同一個「拒絕」後面的請求不會再問一次（用拒絕次數判斷，不用時間戳，避免同一毫秒的誤判）。
- renderer：`SshVpnStartConfirmHost` 掛在 `AppRootSurfaces`（跟 `DotnetPublishDialogHost` 同一區），用既有的 `CommandConfirmProvider` 顯示。
- 拒絕不算錯誤：IPC 結果帶 `declined: true`，UI 不跳錯誤訊息。
- SSH 頁：先檢查主機名稱能不能安全輸入，再啟動 VPN（會先跳 VPN 確認），然後才跳原本的 ssh 指令確認，指令是 `ssh -o 'ProxyCommand=<docker> exec -i <容器> nc -w 30 %h %p' <主機>`。Windows 的終端機可能是 cmd 或 PowerShell，所以用 PATH 上的 `docker` 加雙引號。

**新檔案**：`src/shared/ssh-vpn-command-format.ts`（POSIX 引號、通道 argv、ProxyCommand、終端機選項，main 和 renderer 共用）；`src/main/ssh-vpn/` 的 `ssh-vpn-start-commands.ts`、`ssh-vpn-start-approvals.ts`、`ssh-vpn-runtime.ts`、`ssh-vpn-ipc.ts`（`sshVpn:*`）；`src/preload/api/ssh-vpn-{api,bridge}.ts`；`src/renderer/src/components/ssh-vpn/`（store、狀態點、設定檔表單／列／面板、VPN 按鈕與對話框、主機右鍵選單與 badge、啟動確認）；`ssh-page/ssh-session-vpn.ts`。

**upstream 掛載點（新增）**：`preload/api-types.ts`、`preload/index.ts`（各 2 行）、`AppRootSurfaces.tsx`（2 行）。fork 檔案：`SshHostList.tsx`（VPN 按鈕、右鍵選單、badge）、`ssh-session-{actions,command}.ts`、`CommandConfirmProvider.tsx`（確定按鈕加 `data-command-confirm-accept`）。

**UI**：主機欄（SSH 頁和 SFTP 頁共用）搜尋框旁的「VPN」按鈕，有整體狀態點；對話框可以新增、編輯、刪除設定檔（刪除要按兩次），連線／中斷連線，也能看失敗原因和 OpenVPN 日誌。主機右鍵選單可以選「直接連線」或某個 VPN。有指定 VPN 的主機顯示 badge（狀態點＋設定檔名稱）。存檔前會先解析 .ovpn，帳密或 MFA 設定檔在存檔時就會被擋下。

**i18n**：en／zh 共 44 個 key，zh-TW 用 generator 產生。「證書」「斷開」改寫 zh 原文，產生出「憑證」「中斷連線」。

**測試**：
- 單元／整合：ssh-vpn 相關加上 SSH／SFTP／core handler，共 2601 個全過；Docker 整合測試 5 個（`ORCA_TEST_SSH_VPN_DOCKER=1`）也全過。
- e2e：`ORCA_E2E_SSH_VPN_DOCKER=1 node_modules/.bin/playwright test --config tests/playwright.config.ts tests/e2e/ssh-vpn-docker.spec.ts`（約 20 秒）。驗證：SFTP 經由 VPN 取得 home（先按啟動確認）、主機清單的 badge 和綠色狀態點、SSH 頁分頁打出含 ProxyCommand 的 ssh 並連到只有 VPN 進得去的 sshd。
- 測試內網移到 `tests/e2e/helpers/docker-ssh-vpn-network.ts`（fixture 在 `tests/e2e/fixtures/ssh-vpn/`），因為 e2e spec 不 import src；vitest 整合測試反過來 import 它。
- 注意：在 worktree 跑 e2e 會觸發 `pnpm install`，經由 symlink 重建主 checkout 的 `node_modules` 原生模組（跟 `pnpm dev` 一樣，主 checkout 的 git 狀態不受影響）。

**還沒做**：刪除主機時清掉它的 VPN 指派（`pruneAssignments` 已寫好但沒有呼叫）、`orca serve` 模式（見 Phase 0 紀錄）。

### 程式碼審查的修正（2026-09-29）

Phase 1 完成後，請一個 reviewer 讀過整個 diff。沒有 critical，以下都已修正並有測試：

| 嚴重度 | 問題 | 修正 |
|---|---|---|
| High | 容器本身接在 Docker 的網路上，VPN 沒推送路由（split tunnel）、路由安裝失敗或 OpenVPN 重新連線時，`nc` 會經由 Docker NAT 直接連出去，UI 卻顯示「經由 VPN」 | 映像檔加入 iptables 和 `tunnel` 使用者。每條連線的 `nc` 用 `docker exec --user tunnel` 執行，防火牆（`orca-vpn-firewall`，啟動流程的一步，確認框也會列出）只允許它從 `tun+` 出去，外加 DNS。`Initialization Sequence Completed With Errors` 視為啟動失敗 |
| Medium | `ssh-vpn.json` 不是合法 JSON 時會被當成空的（全部主機改成直連，下次存檔還會蓋掉檔案）；指派到無效設定檔的主機也會直連 | 兩種情況都改成拒絕連線並說明原因；檔案不會被覆寫 |
| Medium | ControlMaster 的 socket key 不含 VPN，指派 VPN 前留下的直連 master 可能被沿用 | key 加入主機的 VPN（沒有 VPN 的主機 key 不變）；SSH 頁的指令加 `-S none`，避免沿用使用者自己設定的 ControlMaster |
| Medium-low | 啟動時讀不到 `ssh-vpn.json`，錯誤會中斷 core handler 註冊，整個 app 壞掉 | 啟動時的讀取包在 try/catch 裡，只記錄錯誤 |
| Low | `setenv opt X` 可以繞過指令過濾；`plugin` 沒有被拿掉 | `setenv opt X` 以 X 檢查；`plugin` 一律拿掉 |
| Low | 引用的檔案沒有先檢查就整個讀進來（`/dev/zero`、FIFO、Windows UNC 路徑） | 先 `stat`：只接受 1MB 以內的一般檔案，拒絕 UNC 路徑 |
| Low | 系統 ssh 的 ProxyCommand 由 shell 執行，主機名稱沒有驗證 | 主機名稱（含 `~/.ssh/config` 的 HostName）必須是 shell 不會展開的字元 |

### 帳密登入（2026-09-29，使用者要求，原本不在第一版範圍）

使用者手上大部分 .ovpn（ASUS 路由器、「豐田固定ip」）都用 `auth-user-pass`。
- **解析**：`auth-user-pass` 沒有帶檔案時標記「需要帳密」並拿掉這行；帶檔案時跟憑證一樣複製進容器；拿掉 `auth-retry`（`interact` 會停在沒人能回答的提示）。MFA（`static-challenge`）仍然不支援。
- **表單**：選擇 .ovpn 後由 main 解析（`sshVpn:inspectOvpn`）。需要帳密時才顯示帳號、密碼（可留空，連線時再問）和保存方式（系統鑰匙串／到 Orca 關閉／每次都問，沒有鑰匙串時不提供第一種）。
- **保存**：`SshVpnPasswordVault` 用既有的 `SealedSecretFile`（系統鑰匙串加密，不存明文）或記憶體；`ssh-vpn.json` 只存帳號。
- **啟動**：確認框多列一行「寫入帳密（不顯示）」；帳密寫到容器 tmpfs 的 `/run/orca/login`（只有 root 能讀），OpenVPN 用 `--auth-user-pass /run/orca/login --auth-nocache`。
- **詢問**：沒有保存密碼，或上次被伺服器拒絕（`AUTH_FAILED`，會先清掉保存的密碼）時，main 請 renderer 跳出登入框（`SshVpnLoginPromptHost`，掛在同一個全域 host），會附上上次被拒絕的原因。取消等同不啟動，不跳錯誤。
- main 向 renderer 詢問的機制抽成 `SshVpnRendererRequests<請求, 答案>`，啟動確認和登入共用。

### Phase 2：設定頁（2026-09-29）——已完成

- 設定 → SSH 的「已儲存的密碼」下方加上 VPN 區塊（跟 SSH 頁對話框同一個面板）；主機卡片顯示 VPN badge。
- 主機編輯表單加上 VPN 下拉選單，按儲存時寫入。**新增主機時停用**，並提示存檔後再選（或在 SSH 頁按右鍵）。原因：新主機要等 `addTarget` 回傳才有 id，要支援就得改 `SshPane.tsx`，而它的有效行數已經在上限（399／400），又不能停用 max-lines。
- 設定頁搜尋可以用「vpn」「openvpn」「ovpn」找到這個區塊。
- upstream 掛載點：`settings-remote-security-section-renderers.tsx`（2 行）、`SshTargetForm.tsx`（5 行）、`SshTargetCard.tsx`（2 行）、`ssh-search.ts`（1 個搜尋項目）。

### 驗證（截至 2026-09-29 最新）

- 單元：ssh-vpn、SSH／SFTP、設定頁、core handler、child-process 邊界等全部通過。
- Docker 整合測試 7 個：原本 5 個，加上「防火牆對照（root 連得到外網，`tunnel` 連不到）」和「帳密登入（錯誤密碼得到 `AUTH_FAILED` 並清掉；正確密碼經由 VPN 連到 sshd；帳密檔是 `600 root`）」。測試伺服器多開一個需要帳密的 OpenVPN（udp/1195）。
- e2e 2 個：原本的憑證流程，加上「沒有保存密碼時跳出登入框，輸入後 SFTP 經由 VPN 連線，密碼依設定保存」。
- 測試內網的 helper 放回 `src/main/ssh-vpn/ssh-vpn-test-network.ts`（改用 `runProcess`），e2e spec 從 src import（已有前例），fixture 仍在 `tests/e2e/fixtures/ssh-vpn/`。

### Phase 3：收尾（2026-09-29）——已完成

- 使用者用自己的「豐田固定ip.ovpn」（ASUS RT-AC86U，憑證加帳密）實測成功。過程中發現並修正：ASUS 會推送 Windows 專用的 `block-outside-dns`，OpenVPN 在 Linux 上只記一行「Options error」警告就繼續，但 manager 把所有「Options error」都當成致命錯誤。現在只有 `AUTH_FAILED` 和「Exiting due to fatal error」會讓啟動失敗，另外加上 `--pull-filter ignore block-outside-dns`；測試伺服器也改成會推送這個選項。
- 刪除主機後殘留的指派：VPN UI 每次載入時，依 SSH 主機清單清掉（不必掛在 upstream 的刪除流程上；重新加入的主機會拿到新的 id）。
- **更正 Phase 0 對 `orca serve` 的推測**：main 的 SSH 連線都由 `registerSshHandlers` 建立，它只在有視窗的模式執行，而且在 `registerCoreHandlers`（VPN 服務註冊的地方）之後（`desktop-startup-ordering.test.ts` 保證這個順序）。沒有視窗時 main 不建立 SSH 連線，所以不存在繞過 VPN 的路徑，不需要另外處理。

### 資料庫連線走 VPN（2026-09-29，使用者要求）

- 資料庫的伺服器連線（PostgreSQL、MySQL／MariaDB、SQL Server）多一個「VPN」欄位，選的是設定 → SSH 裡同一批 VPN 設定檔。存在資料庫連線自己的 `vpnProfileId`（fork 自己的型別，不必像 SSH 主機那樣另存到 `ssh-vpn.json`）。
- 做法沿用資料庫 SSH 通道的形狀：main 開一個 `127.0.0.1` 的本機 port，每條進來的連線各跑一個 `docker exec -i --user tunnel <容器> nc -w 30 <主機> <埠>`（`database-vpn-tunnel.ts`）。driver 和原生 pg_dump／mysqldump 都連這個 port，所以不用各自支援自訂 socket。
- 連線前先用 `nc -z` 探測一次，連不到時直接說「VPN X could not reach host:port（nc 的原因）」，不會開出一個死的 port。
- 一樣 fail closed：VPN 起不來、被拒絕、設定檔被刪掉，或連線途中 VPN 斷掉（監聽 manager 的狀態），連線就失敗或結束，不會改成直接連線。VPN 沒有 `ready` 時進來的連線直接關掉，不會 spawn。
- 啟動 VPN 用同一個確認框和登入框，說明文字是「Connecting to <連線名稱> needs this VPN.」。
- 關閉時只關掉 `nc` 的 stdin（`nc -w 30` 會在 30 秒內結束），不直接 kill `docker exec`，否則 `nc` 會留在容器裡，被閒置檢查當成使用中。
- 跟 SSH 通道擇一：選了 SSH 通道時 VPN 欄位停用，因為 SSH 通道本來就會套用那台 SSH 主機自己的 VPN 設定；兩者同時存在的舊資料會被 main 拒絕。
- 掛載點：`ssh-vpn-database-route.ts`（跟 `ssh-vpn-route.ts` 一樣的 seam，VPN runtime 在資料庫 handler 之後註冊）。`SshVpnService.connect` 多收一個連線名稱並回傳設定檔名稱。
- 測試：單元（tunnel 7、session manager 4、表單 1、對話框 1）；Docker 整合 4 個（VPN 外連不到、經 VPN 的 DNS 名稱連到並在關閉後容器內沒有殘留 `nc`、連不到時的錯誤、VPN 停掉時結束連線）；e2e 1 個（MariaDB 10.5 放在只有 VPN 連得到的網路，走對話框選 VPN、測試、存檔、開 console 查詢）。測試內網多了 `startBehindVpn`。

### 借用已在執行的 VPN 容器（2026-10-01，使用者要求）

- 起因：使用者已經用 `~/myprojects/openvpn-socks` 在 Docker 裡跑辦公室 VPN（給 Chrome 走 SOCKS）。Orca 再用同一份 .ovpn 起一條，伺服器沒開 `duplicate-cn` 時兩邊會互踢。
- 設定檔多一種 `kind: 'container'`，只存容器名稱（`containerName`）。原本的設定檔沒有 `kind`，一律當 .ovpn，檔案格式不用遷移。
- 不走 SOCKS：三條路（ssh2、系統 ssh 的 ProxyCommand、資料庫）本來就是 `docker exec -i --user tunnel <容器> nc …`，借用容器只換容器名稱，連線程式碼不動。SOCKS 的話，SSH 頁終端機需要會講 SOCKS 的 nc（Windows 沒有），也無法確認 fail closed。
- Orca 不啟動、停止、刪除借用的容器，也沒有閒置斷線；關閉 Orca 時不碰它（`runningContainers` 只列 Orca 自己的）。「Disconnect」只是讓 Orca 不再把它當 ready。
- 每次 acquire 都重新檢查（`borrowed-container-check.ts`）：容器在執行；有 healthcheck 時要 healthy；有 `tunnel` 使用者；`iptables -S OUTPUT` 和 `ip6tables -S OUTPUT` 符合 Orca 自己的規則形狀（`borrowed-container-firewall.ts`：只認得 lo／tun+ 放行、到 /32、/128 的 DNS 放行，最後 REJECT 或 policy DROP；看不懂的規則一律當不安全）。已經 ready 時重新檢查不改狀態，因為資料庫通道在狀態離開 `ready` 時就會斷。另外每 60 秒自己檢查一次，容器停掉時轉成 error。
- 存檔時也會檢查（不要求 healthy），所以容器沒照規則設定時存不進去。
- 不跳啟動確認框（沒有東西要啟動）；表單直接顯示每條連線會跑的指令。
- 程式碼：`ssh-vpn-borrowed-containers.ts`（狀態、重新檢查）由 `SshVpnManager` 依 `kind` 轉交；同一個 id 換種類時先停掉另一邊。介面：表單上方切換「OpenVPN 設定檔／我已在執行的容器」，`SshVpnContainerField.tsx` 列出 `docker ps`（排除 Orca 自己的容器）；列表列只有「檢查」按鈕。
- openvpn-socks 那邊：Dockerfile 加 `iptables` 和 `tunnel` 使用者，`entrypoint.sh` 在啟動 OpenVPN 前跑 `tunnel-firewall.sh`（規則同 Orca；重啟時從 `/tmp/resolv.conf.orig` 讀 Docker 自己的 DNS）。要重新 build 容器才生效。

## 10. 使用說明與已知限制

**需求**：Docker Desktop、OrbStack 或 Colima 正在執行。第一次連線會在本機建置 `orca-ssh-vpn:<雜湊>` 映像檔（需要連網，約數十秒）。

**設定**：
1. 在 SSH 頁或 SFTP 頁主機欄的「VPN」按鈕，或設定 → SSH 的 VPN 區塊，新增 .ovpn。需要帳密的設定檔會多出帳號、密碼和保存方式。
2. 在主機上按右鍵選 VPN，或在設定 → SSH 編輯主機時選。新增主機時要先存檔才能選。
3. 連線時會先跳出確認框，列出每一條 docker 指令；沒有保存密碼時會再跳登入框。

**行為**：
- 每個設定檔一個容器（`orca-ssh-vpn-<實例>-<設定檔 id>`），不開任何 port；每條連線是一個 `docker exec -i --user tunnel <容器> nc -w 30 <主機> <埠>`，防火牆只允許它從 VPN 出去。
- 沒有連線使用時，閒置設定的分鐘數（預設 10）後自動斷線；關閉 Orca 時一定移除容器。當機留下的容器會在下次啟動時清掉。
- VPN 起不來、設定檔壞掉、或主機的 VPN 設定檔不見時，一律拒絕連線，不會改成直接連線。

**借用已在執行的容器**：新增設定檔時選「我已在執行的容器」，再從清單選容器。容器裡要有 `tunnel` 使用者和上面那組防火牆規則（openvpn-socks 已內建），Orca 每次連線前都會檢查，不合就拒絕連線。容器的啟停由你自己管理。

**資料庫連線**：新增或編輯資料庫連線時，在「VPN」欄位選設定檔即可（SQLite 沒有這個欄位）。主機和埠要填 VPN 內部看到的位址。連線期間 main 會開一個 `127.0.0.1` 的本機 port 接到 VPN，本機其他程式在這段時間也能連到它（跟資料庫的 SSH 通道一樣）。

**已知限制**：
- 不支援：一次性驗證碼（MFA，`static-challenge`）、SSO／SAML、硬體權杖、密碼保護的私鑰。
- 主機若已經設定 ProxyJump／ProxyCommand（包含 `~/.ssh/config` 的 `Host *`），不能再指定 VPN。
- VPN 沒有推送到目標主機的路由時（split tunnel），連線會被防火牆拒絕，而不是直接連出去。錯誤訊息目前只顯示 SSH 層的連線失敗，沒有特別說明是「VPN 沒有這台主機的路由」。
- Windows 和 Linux 只有單元測試覆蓋；Windows 的 SSH 頁指令依賴 PATH 上的 `docker`。

**測試**：
```
node_modules/.bin/vitest run --config config/vitest.config.ts src/main/ssh-vpn src/shared/ssh-vpn-command-format.test.ts src/renderer/src/components/ssh-vpn src/renderer/src/components/ssh-page
ORCA_TEST_SSH_VPN_DOCKER=1 node_modules/.bin/vitest run --config config/vitest.config.ts src/main/ssh-vpn/ssh-vpn-docker.integration.test.ts src/main/database/database-vpn-tunnel.integration.test.ts
ORCA_E2E_SSH_VPN_DOCKER=1 node_modules/.bin/playwright test --config tests/playwright.config.ts tests/e2e/ssh-vpn-docker.spec.ts tests/e2e/database-vpn-docker.spec.ts
```
