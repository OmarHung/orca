# 編輯器程式碼跳轉：Vue／Nuxt 支援計畫（fork 專屬）

> 狀態：規劃中（2026-10-01），尚未實作。§7 有待使用者決定的事項。
> 前置：[`code-navigation-lsp-plan.md`](./code-navigation-lsp-plan.md)（TS／JS／C# 的跳轉、JetBrains 快捷鍵、明確跳轉才啟動伺服器）。本文件只寫 Vue／Nuxt 多出來的部分。
> 對象：接手實作的人或新對話。本文件可獨立閱讀。

## 1. 目標

在 Vue 3 與 Nuxt 專案裡，讓 `.vue` 檔也有跟 `.ts` 一樣的跳轉，並讓 `.ts` 查參照時找得到 `.vue` 裡的用法：

- 跳到定義（⌘B／F12／⌘點擊）、找參照（Shift+F12）、跳到實作、跳到型別定義、hover
- `.vue` 的 `<script>`（含 `<script setup>`）與 `<template>`：元件標籤、事件處理函式、`v-bind`／插值裡的運算式
- Nuxt：自動匯入的元件、composable、store、`navigateTo` 等框架函式要跳到原始碼，不是 `.nuxt/` 產生的宣告

現況：`.vue` 只有語法上色（`register-vue.ts`），沒有任何跳轉；Vue 專案裡的 `.ts` 走 TS 7，看不到 `.vue` 檔，查參照會漏掉 `.vue` 裡的用法。

## 2. 為什麼不能沿用 TS 7

Vue 官方工具（Vue Language Tools 3.3.11，2026-08）的跳轉／參照／hover 由 TypeScript plugin `@vue/typescript-plugin` 提供：它把 `.vue` 的 script 與 template 轉成虛擬 TS 程式碼，讓 tsserver 分析。`@vue/language-server` 本身只處理 HTML／CSS 等 template 功能，並透過自訂的 `tsserver/request` 通知把 TS 相關請求轉給掛著 plugin 的 tsserver。

TypeScript 7（Go 原生版，Orca 目前用的 7.0.2）沒有 tsserver，也沒有 plugin 機制（套件裡沒有 `tsserver.js`，也沒有 plugin 載入程式），所以 Vue 專案需要另一個 JS 版 TypeScript 的伺服器。

## 3. 原型實測（2026-10-01）

伺服器：[vtsls](https://github.com/yioneko/vtsls) 0.3.0（把 tsserver 包成標準 LSP）＋ `@vue/typescript-plugin` 3.3.11（設定 `vtsls.tsserver.globalPlugins`，`languages: ['vue']`）。**不需要** `@vue/language-server`。測試腳本：scratchpad 的 `lsp/vsmoke.mjs`。

### 3.1 Vue 3 + Vite（`ecommerce_project/frontend/admin`，TS 5.7.3，119 個 `.vue`）

| 位置 | 查詢 | 結果 |
|---|---|---|
| template | `<ContentWrap>`（具名匯入的元件） | `src/components/ContentWrap/src/ContentWrap.vue` |
| template | `<BannerPickerDialog>`（`./X.vue` 匯入） | `BannerPickerDialog.vue` |
| template | `@click="handleSave"` | 同檔 script 的 `handleSave` |
| template | `<el-button>`（全域註冊的 element-plus） | element-plus 的 `button/index.d.ts` |
| script | `getHomepageSectionsApi()` | `src/api/homepage/index.ts` |
| script | `import X from './X.vue'` 的 X | 該 `.vue` 檔 |
| script | `handleSave` 找參照 | script 宣告＋template 的 `@click` |
| `.ts` | `getHomepageSectionsApi` 找參照 | `.ts` 宣告＋`.vue` 裡的匯入與呼叫 |
| script | hover | `const handleSave: () => Promise<void>` |

### 3.2 Nuxt 4（`ecommerce_project/frontend/shop`，`.nuxt/` 已產生）

| 查詢 | 直接結果 | 備註 |
|---|---|---|
| `<LayoutAppHeader />`、`<CommonToastHost />`（自動匯入元件） | 對應的 `.vue` | 直接可用 |
| `useToast()`（自動匯入 composable） | `app/composables/useToast.ts` ＋ `.nuxt/types/imports.d.ts` | 多一筆產生檔 |
| `useCartStore()`（pinia store） | pinia 的 `pinia.d.ts` ＋ `.nuxt/types/imports.d.ts` | **沒到** `app/stores/cart.ts` |
| `navigateTo()` | 只有 `.nuxt/types/imports.d.ts` | **沒到**原始碼 |
| `cartStore.refresh()` | `app/stores/cart.ts` | 直接可用 |

`.nuxt/types/imports.d.ts` 的每一行是 `const X: typeof import('<路徑>').X`。在行尾 `import(...)` 後面那個 `X` 上再查一次定義，就會到原始碼：`useCartStore` → `app/stores/cart.ts:49`、`useToast` → `useToast.ts:14`、`navigateTo` → nuxt 的 `router.d.ts`、`computed` → `runtime-core.d.ts`。這個二次解析由 Orca 做（§4.5），跟 C# 的 MediatR 處理同一個模式。

### 3.3 載入與資源

- 冷啟動到能正確回答：Nuxt shop 約 2.5 秒。載入完成前 vtsls 回的是**空陣列**（不是錯誤），因為請求先轉給語法伺服器。vtsls 會在用戶端宣告 `window.workDoneProgress` 時送出「Initializing '…'」進度，Orca 要等進度結束再發第一個查詢（同 csharp-ls 的載入等待）。
- `vtsls.autoUseWorkspaceTsdk: true` 時用專案的 `node_modules/typescript`（實測 vtsls 的 log 為 shop 的 `node_modules/typescript/lib/tsserver.js`，5.9.3）；根目錄沒有 TypeScript 時退回內附版本。根目錄設在整個 repo（`ecommerce_project`）也能用，但會用內附版本。
- 安裝內容：vtsls ＋ plugin 的相依共 38 個 npm 套件、38 MB（其中 TypeScript 5.9.3 佔 23 MB）。

## 4. 設計

### 4.1 新的伺服器種類 `vue`

- `CodeNavigationServerKind` 加 `vue`；啟動方式同 JS debug adapter：`process.execPath` ＋ `ELECTRON_RUN_AS_NODE=1` 執行 `@vtsls/language-server/bin/vtsls.js --stdio`，不依賴使用者裝的 Node。
- 設定（`workspace/configuration` 與 `initializationOptions`）：`vtsls.tsserver.globalPlugins = [{ name: '@vue/typescript-plugin', location: <安裝目錄>, languages: ['vue'], configNamespace: 'typescript', enableForWorkspaceTypeScriptVersions: true }]`、`vtsls.autoUseWorkspaceTsdk = true`。
- 用戶端能力宣告 `window.workDoneProgress`；session 在第一個「Initializing」進度結束前讓查詢等待（有逾時）。

### 4.2 哪些檔案走 `vue`

- `.vue` 一律走 `vue`（Monaco 語言 `vue` 加入 `CODE_NAVIGATION_MONACO_LANGUAGES`，languageId `vue`）。
- `.ts`／`.tsx`／`.js`／`.jsx`／`.mts`／`.cts`／`.mjs`／`.cjs`：檔案往上找到的第一個 `package.json` 若相依（dependencies／devDependencies）含 `vue` 或 `nuxt`，就走 `vue`；否則照舊走 TS 7。理由見 §3.1 最後一列：TS 7 找參照會漏掉 `.vue`。（待決定 Q2）
- 判斷在 main 做（renderer 仍依副檔名送 `typescript`／新的 `vue` 請求，main 依專案改派），結果依 `package.json` 路徑快取，`package.json` 變更時失效。

### 4.3 根目錄

`vue` session 的根目錄是 §4.2 找到的那個 `package.json` 所在資料夾（例如 `frontend/shop`），不是 Orca 工作區根目錄：這樣 `autoUseWorkspaceTsdk` 會用專案自己的 TypeScript，一個 repo 裡的多個前端專案各自一個 session（沿用現有的 LRU／閒置回收）。

### 4.4 安裝

沿用 `userData/language-servers/` 與「第一次用到才下載」（D3）。vtsls 不是單一壓縮檔，而是 38 個 npm 套件，所以：

- 新增 `vue-language-server-manifest.ts`：由腳本從 `package-lock.json` 產生，每個套件記錄 `node_modules` 內路徑、registry tarball URL、npm 的 `integrity`（sha512）。
- 安裝器逐一下載、驗證 integrity、解壓到 `language-servers/vue/<版本>/node_modules/<路徑>`，全部成功才寫入完成標記（失敗就整個目錄丟掉，下次重來）。
- 升級版本＝重跑產生腳本。（安裝方式待決定 Q1）

### 4.5 Nuxt 自動匯入的二次解析

在 `code-navigation-service` 的定義類查詢（definition／typeDefinition／implementation）後處理：

1. 結果中位於 `<根目錄>/.nuxt/` 的位置，讀該行；若符合 `typeof import('…').Name`，在行尾 `Name` 上再對同一個 session 查一次定義。
2. 得到 `.nuxt/` 以外的位置就取代原位置；同一次查詢有任何一筆解析成功時，丟掉其餘仍在 `.nuxt/` 裡的位置，以及像 `useCartStore` 那種落在 `node_modules` 型別、而另一筆已解析到專案原始碼的重複結果（只在二次解析有結果時才丟，避免把唯一的答案丟掉）。
3. `.nuxt/` 不存在（專案沒跑過 `nuxi prepare`／`npm install`）時，自動匯入的名稱會查不到：顯示一次性提示。（處理方式待決定 Q3）

### 4.6 編輯器端

- `vue` 語言註冊既有的 definition／references／implementation／typeDefinition／hover providers；peek 預覽的 `orca-lsp-preview:` model 用 `vue` 語言建立，才有上色。
- `.vue` 沒有 Monaco 內建的 TS 功能，不需要像 TS 那樣關掉內建 provider。
- 沿用「明確跳轉才啟動伺服器」（`859bb41209`）：hover 與預熱只在該專案啟動過之後才會用到 `vue` session，且從不觸發下載。
- `isCodeNavigationWatchedPath` 的 `vue` 種類監看 `.vue` 與上述 TS／JS 副檔名，以及 `package.json`（§4.2 的快取）。

## 5. 不做／限制

- `@vue/language-server` 的 template 專屬功能（HTML／CSS 補全、標籤配對等）：與跳轉無關，不跑這個伺服器。
- Vue 2：未測。Vue Language Tools 3 以 Vue 3 為主，Vue 2.7 專案不保證可用。
- SSH／WSL：同主計畫 Phase 3，未開始。
- Nuxt 的 server 路由（`server/api/*`）與 `$fetch('/api/…')` 字串的對應：本計畫不做，可另立（類似 ASP.NET MVC 的字串對應）。

## 6. 實作階段與驗證

1. 安裝器與 manifest（含產生腳本）→ 單元測試：integrity 驗證失敗、部分失敗不留半套。
2. `vue` 種類、啟動、設定、載入等待 → 單元測試；整合測試（opt-in，`ORCA_TEST_VTSLS_DIR` 指向已安裝的目錄）：建一個 Vite＋Vue 小專案，驗 §3.1 的 template／script／`.ts` 找參照。
3. §4.2 派送與 §4.3 根目錄 → 單元測試（package.json 判斷、快取失效、monorepo 兩個前端）。
4. Nuxt 二次解析 → 單元測試（假 session）；整合測試用一個最小 Nuxt 專案需要 `nuxi prepare`，改用手寫的 `.nuxt/types/imports.d.ts` fixture。
5. 編輯器端 → e2e（`ORCA_E2E_CODE_NAVIGATION=1`）：`.vue` 裡 ⌘B 元件標籤開到元件、⌘[ 回來；`.ts` Shift+F12 列出 `.vue` 用法。
6. 用 `ecommerce_project` 的 shop／admin 手動驗收後再發佈。

## 7. 待決定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| Q1 | 伺服器怎麼取得 | (a) 第一次用到時從 npm 下載 38 個套件並驗證；(b) 打包進 Orca app（app 大約多 38 MB） | (a)，與 TS／C# 伺服器一致，不影響 app 大小 |
| Q2 | Vue 專案裡的 `.ts`／`.js` | (a) 改走 vtsls，找參照含 `.vue`；(b) 維持 TS 7（較快、較省記憶體），但查參照漏掉 `.vue` | (a) |
| Q3 | `.nuxt/` 不存在時 | (a) 提示執行 `nuxi prepare`；(b) Orca 自動在背景執行；(c) 不處理 | (a)；(b) 會在使用者專案裡跑指令、寫檔 |
