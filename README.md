<h1 align="center">
  <a href="https://onOrca.dev"><img src="resources/build/icon.png" alt="Orca" width="64" valign="middle" /></a> Orca
</h1>

<p align="center">
  <a href="https://github.com/stablyai/orca"><img src="https://img.shields.io/github/stars/stablyai/orca?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars" /></a>
  <a href="https://github.com/stablyai/orca/releases"><img src="docs/assets/readme-downloads.svg" alt="Total downloads across all releases" /></a>
  <img src="https://img.shields.io/badge/license-MIT-08C?style=flat" alt="License: MIT" />
  <a href="https://discord.gg/fzjDKHxv8Q"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Join the Orca Discord" /></a>
  <a href="https://x.com/orca_build"><img src="https://img.shields.io/badge/X-000000?logo=x&logoColor=white" alt="Follow Orca on X" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
</p>

<p align="center">
  <sub><a href="docs/readme/README.zh-CN.md">中文</a> · <a href="docs/readme/README.ja.md">日本語</a> · <a href="docs/readme/README.ko.md">한국어</a> · <a href="docs/readme/README.es.md">Español</a> · <a href="docs/readme/README.fr.md">Français</a> · <a href="docs/readme/README.pt.md">Português</a> · <a href="docs/readme/README.tr.md">Türkçe</a> · <a href="docs/readme/README.ru.md">Русский</a></sub>
</p>

<p align="center">
  <strong>The AI Orchestrator for 100x builders.</strong><br/>
  Run Claude Code, Codex, and any other coding agent in parallel, each in its own worktree. Chat or terminal, on your laptop or in the cloud, with diffs, a browser, and a CLI in one app.
</p>

<h3 align="center"><a href="https://onorca.dev/download"><ins>Download Orca</ins></a></h3>

<p align="center">
  <img src="docs/assets/readme-hero.jpg" alt="Orca desktop app with a coordinator agent running worker agents in parallel workspaces, and the Orca mobile app in the corner" width="960" />
</p>

## 本 fork 加上的功能（OmarHung/orca）

> 這是 [stablyai/orca](https://github.com/stablyai/orca) 的 fork。`omar/custom` 分支是 upstream 的發行版 tag，再加上本 fork 自己的 commit。下面列的功能只在這個分支裡；[官方下載](https://onorca.dev/download)的版本沒有，要自己建置（見[建置與更新](#建置與更新)）。設計文件都在 `docs/fork/`。

### Run／Debug（JetBrains 風格）

[設計文件](docs/fork/run-debug-configurations-plan.md)

- 右上角的 Run widget：選設定後 Run／Debug／Stop／Rerun，清單裡有自動偵測到的執行項目、已存的設定、最近 5 次執行和目前檔案；執行中的程式顯示在 Run tool window，可以各自停止
- 自動偵測 .NET、Node、Python 專案和 Docker Compose／Dockerfile，依 toolchain、專案、類型分組；檔案樹右鍵可以 Build／Run／Test／Publish
- Edit Configurations：Before launch 步驟、compound（一次啟動多個）、匯入 `launch.json`、用 `orca.yaml` 跟團隊共享設定
- Rider 風格的 .NET「Publish to folder」；把 Dockerfile 的 stage 匯出到資料夾、重建 compose
- 顯示 run／debug session 監聽的 port，點了就能開
- 內建除錯器：Python（debugpy）、JavaScript／TypeScript 和 npm scripts（js-debug）、.NET（netcoredbg）。支援條件中斷點、logpoint、例外中斷、Watch、Console REPL、inline values，暫停時滑過程式碼會跳出 JetBrains 風格的值視窗；可以同時除錯多個程式
- 每個專案自動偵測 Python interpreter
- .NET 5 以前、沒有 arm64 版本的舊專案，在 arm64 Docker 容器裡執行、除錯、跑 `dotnet ef`（[設計文件](docs/fork/dotnet-container-toolchain-plan.md)）

### 程式碼跳轉（LSP）

[設計文件](docs/fork/code-navigation-lsp-plan.md)・[Vue／Nuxt](docs/fork/code-navigation-vue-nuxt-plan.md)

- C#、TypeScript／JavaScript、Vue／Nuxt：跳到定義、找參照、跳到實作、跳到型別定義、hover 說明；C# 可以跳進反編譯的原始碼
- JetBrains 快捷鍵（⌘B、⌘⌥B、⌘⇧B、⌥F7…，可在設定裡改）和 Back／Forward 跳轉歷史；⌘⌥點擊直接跳到實作
- MediatR：對 request 跳到實作會開它的 handler
- Razor view 和 ASP.NET MVC 慣例
- Explorer 檔案樹下方的 Structure（大綱）面板，支援 Go、Java、Rust、C／C++、PHP、Ruby、shell、PowerShell、CSS、JSON、YAML 等語言

### Git

- JetBrains 風格的 Git Log 底部面板：樹狀顯示、可調寬的欄位、選一個分支或全部分支；任選兩個 commit／分支比較，多選 commit 看它們一起改了哪些檔案；標出目前分支也有的、已經 cherry-pick 過的 commit；分支和 commit 的右鍵操作；在任何地方做了 git 操作都會自動重新載入
- 狀態列顯示目前分支要推（↑）、要拉（↓）的 commit 數和未提交的檔案，可設定自動 fetch
- 編輯器：JetBrains 風格的變更標記 gutter；GitLens 風格的游標行 blame（點擊展開卡片）；右鍵把檔案跟某個分支或 revision 比較；從單一檔案的 commit diff 打開工作區裡的檔案
- Source Control 的「Committed on Branch」預設收合

### Database（DataGrip 風格，唯讀）

[設計文件](docs/fork/database-gui-plan.md)

- 左側欄的 Database 頁，支援 PostgreSQL、MySQL／MariaDB、SQL Server、SQLite
- Explorer：資料庫、schema、資料表、view、routine、key、index 和註解；連線可以分組、用顏色標示正式環境，圖示顯示資料庫類型和連線狀態；可以看 server／database／schema／table 的 Properties
- SQL console：自動補全、格式化、查詢歷史、切換 database／schema
- 資料表分頁和結果表格，複製和匯出都用完整的值；Show DDL
- 一律唯讀：伺服器端強制唯讀，送出前也會先檢查語句
- Dump to SQL（內建引擎，或用 pg_dump／mysqldump）和 Export Data，都在背景執行
- 透過已存的 SSH 主機（tunnel）或 VPN 設定檔連線

### SSH、SFTP 與 VPN

[SSH／SFTP 設計文件](docs/fork/ssh-sftp-pages-plan.md)・[VPN 設計文件](docs/fork/ssh-vpn-plan.md)

- 左側欄的 SSH、SFTP 頁：可搜尋、可分組的主機清單；SSH 頁有跟工作區一樣的分頁列
- SFTP 雙窗格：上傳、下載、從 Finder 拖進來、在兩個窗格間拖曳、移動遠端檔案；分頁、可排序可調寬的欄位、檔案類型圖示、我的最愛資料夾、每台主機記住各自的本機資料夾、顯示選取項目的總大小
- 每個 SSH／SFTP 動作執行前，先列出會跑的確切指令讓你確認
- 記住 SSH key 的 passphrase（用系統 keychain 加密保存）
- 把主機指定給 OpenVPN 設定檔：連這台主機時，Orca 自動在 Docker 容器裡連上 VPN，只有這條連線走 VPN，Mac 本身的網路不受影響；支援帳密登入，也能借用已經在執行的 VPN 容器；在 Settings → SSH 管理

### ngrok

[說明](docs/fork/ngrok-management.md)

- 在狀態列的 Ports 面板用 ngrok 把本機 port 公開分享；SSH 工作區 forward 出來的 port 也可以
- 列出這台機器上所有 ngrok endpoint（包括在終端機手動開的），可以開啟、複製網址、看請求紀錄、停止

### monday.com 時程頁

[說明](docs/fork/monday-schedule-page.md)

- 月曆和甘特圖同時畫 timeline 和 due date；一週從週日開始，標出台灣國定假日
- 選要看誰的項目、依狀態篩選；沒有日期的項目列在旁邊
- 點 task 就能看描述、updates 和連結的項目（例如 Client CRM 紀錄）
- 連結在頁面內建的瀏覽器開，也可以開成獨立視窗
- 「Hand to AI」：把 task 的內容整理成草稿，交給任一工作區的 AI agent

### 其他

- 繁體中文（台灣）介面，每次同步 upstream 時從簡體中文目錄自動產生
- 用量條加上平均用量標記，超前時變黃、快用完時變紅
- agent 分頁的分頁列上可以一鍵清除對話（`/clear`）
- 每個專案可以設定空工作區預設開終端機還是哪個 agent
- 終端機裡點 Claude 的 `[Image #N]` 可以預覽那張圖

### 建置與更新

本機 Apple Silicon 建置，以及把本 fork 的 commit 同步到每個 upstream 發行版的流程，寫在 [`config/scripts/fork-maintenance/README.md`](config/scripts/fork-maintenance/README.md)。
簡單說：`git switch omar/custom && node config/scripts/fork-maintenance/build-mac-local-arm64.mjs`，
再把 `dist/mac-arm64/Orca.app` 拖進 `/Applications`。

這樣建置的 app 不會收到官方更新。有新的 upstream 發行版時，更新卡片會列出它的 release notes，按 **Sync & update** 就自動 rebase、建置並安裝；有衝突時列出每個衝突的 commit，可以按 **Resolve with AI** 交給 agent 處理。更新完會打開一份 AI 寫的 changelog。

---

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Chat or Terminal

Run any agent in Chat UI or as the raw CLI, and move a conversation between the two without losing context.

[Docs →](https://www.onorca.dev/docs/agents/native-chat)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/agents/native-chat"><picture><source srcset="docs/assets/readme-features/chat-or-terminal.webp" type="image/webp"><img src="docs/assets/readme-features/chat-or-terminal.poster.jpg" alt="The same agent conversation in Chat UI and in the terminal, side by side" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Orchestrate Agents

Hand a big task to one agent. It splits the work, starts worker agents in their own workspaces, and brings their results back to you.

[Docs →](https://www.onorca.dev/docs/cli/orchestration)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/cli/orchestration"><picture><source srcset="docs/assets/readme-features/orchestration.webp" type="image/webp"><img src="docs/assets/readme-features/orchestration.poster.jpg" alt="A coordinator agent splitting a task between two worker agents and reporting their results" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Run Anywhere

Pair a Remote Orca Server, work on any SSH host, or give a worktree its own cloud VM. Your agents keep running when your laptop sleeps.

[Docs →](https://www.onorca.dev/docs/ways-to-run)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/ways-to-run"><picture><source srcset="docs/assets/readme-features/remote.webp" type="image/webp"><img src="docs/assets/readme-features/remote.poster.jpg" alt="Choosing which machine a new worktree runs on, from this computer to an SSH host or a per-workspace environment" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Mobile App

Pair Orca with the mobile app to get pinged when an agent needs you, reply in chat, and keep work moving on any of your machines when you are away from your desk.

[iOS App Store](https://apps.apple.com/us/app/orca-ide/id6766130217) · [Android APK](https://www.onorca.dev/download/android) · [Docs →](https://www.onorca.dev/docs/mobile)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/mobile"><picture><source srcset="docs/assets/readme-features/mobile-companion.webp" type="image/webp"><img src="docs/assets/readme-features/mobile-companion.poster.jpg" alt="The Orca mobile app getting a notification that Claude needs input, opening the session, and replying so the agent opens the PR" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Review AI Output

Review diffs, leave notes on exact changed lines, and send focused feedback back to an agent.

[Docs →](https://www.onorca.dev/docs/review/annotate-ai-diff)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/review/annotate-ai-diff"><picture><source srcset="docs/assets/readme-features/annotate-ai-diffs.webp" type="image/webp"><img src="docs/assets/readme-features/annotate-ai-diffs.poster.jpg" alt="A note on a changed diff line sent back to the agent" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Git Integration

Draft commit messages and pull requests from the diff, then send failing checks or PR review comments back to an agent to fix.

[Docs →](https://www.onorca.dev/docs/review/commit-push)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/review/commit-push"><picture><source srcset="docs/assets/readme-features/git-integration.webp" type="image/webp"><img src="docs/assets/readme-features/git-integration.poster.jpg" alt="Drafting a commit and pull request, then sending a review comment back to the agent" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Parallel Worktrees

Quickly split tasks into isolated environments, so multiple agents can work side by side without interfering with each other.

[Docs →](https://www.onorca.dev/docs/model/worktrees)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/model/worktrees"><picture><source srcset="docs/assets/readme-features/parallel-worktrees.webp" type="image/webp"><img src="docs/assets/readme-features/parallel-worktrees.poster.jpg" alt="Creating a new worktree with its own agent next to other running worktrees" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Design Mode

Click any element in Orca's browser to copy its HTML, styles, and selector, then paste it into your agent's chat.

[Docs →](https://www.onorca.dev/docs/browser/design-mode)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/browser/design-mode"><picture><source srcset="docs/assets/readme-features/design-mode.webp" type="image/webp"><img src="docs/assets/readme-features/design-mode.poster.jpg" alt="Picking a button in Orca's browser and sending it to the agent's chat" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### GitHub &amp; Linear, Native

See your GitHub and Linear tasks in one place, and start a workspace for each when you're ready to build.

[Docs →](https://www.onorca.dev/docs/review/linear)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/review/linear"><picture><source srcset="docs/assets/readme-features/github-linear-tasks.webp" type="image/webp"><img src="docs/assets/readme-features/github-linear-tasks.poster.jpg" alt="GitHub and Linear issues in Orca, with a workspace started from a Linear issue" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Orca CLI

Anything you can do in Orca, your agents can do too: create worktrees, start workers, drive the browser and desktop apps, and schedule automations, all from the command line.

[Docs →](https://www.onorca.dev/docs/cli/overview)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/cli/overview"><picture><source srcset="docs/assets/readme-features/orca-cli.webp" type="image/webp"><img src="docs/assets/readme-features/orca-cli.poster.jpg" alt="An agent running orca worktree create to start a worker in a new worktree" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Plugins

Themes, editors, languages, and panels from the community, installed in a click.

[Browse plugins →](https://www.onorca.dev/plugins)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/plugins"><picture><source srcset="docs/assets/readme-features/plugins.webp" type="image/webp"><img src="docs/assets/readme-features/plugins.poster.jpg" alt="Installing the Orca Midnight theme from the plugin catalog" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Split Anything

Put agents, terminals, browsers, and diffs side by side in split panes shaped to the task.

[Docs →](https://www.onorca.dev/docs/model/tabs-panes-splits)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/model/tabs-panes-splits"><picture><source srcset="docs/assets/readme-features/split-anything.webp" type="image/webp"><img src="docs/assets/readme-features/split-anything.poster.jpg" alt="Dragging tabs into split panes with an agent, browser, terminal, and diff" width="100%" /></picture></a>
</td>
</tr>
</table>

**Also in the box:**

- **[Drag Files to Agents](https://www.onorca.dev/docs/editing/file-explorer)**: drag files from the explorer, or images from your desktop, straight into an agent's prompt.
- **[Jump Anywhere](https://www.onorca.dev/docs/model/quick-open)**: one shortcut jumps to any workspace or tab across every repo and host.
- **[Rich Previews](https://www.onorca.dev/docs/editing/viewers)**: open images, PDFs, and Markdown right in the workspace, next to the agent that made them.
- **[Mobile Emulator](https://www.onorca.dev/docs/cli/overview#mobile-emulator)**: run an iOS Simulator or Android emulator beside your agent, and let it tap, type, and check its own work.
- **[Dictation](https://www.onorca.dev/docs/settings#voice)**: press a shortcut and talk. Orca types what you say into the agent's prompt or terminal.
- **[Usage &amp; Accounts](https://www.onorca.dev/docs/agents/usage-tracking)**: see how much of your agent limits you've used and when they reset, and switch accounts without logging out.
- **[Automations](https://www.onorca.dev/docs/cli/automations)**: schedule prompts to run on any repo: nightly dependency bumps, weekly triage, flaky-test sweeps.
- **[Computer Use](https://www.onorca.dev/docs/cli/computer-use)**: when there's no CLI or API, agents can see and drive desktop apps and external browsers.
- **And many, many more**: we ship daily, so this list is perpetually behind. The [changelog](https://github.com/stablyai/orca/releases) is the real feature list.

---

## Supported Agents

Works with **any CLI agent** — if it runs in a terminal, it runs in Orca.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="docs/assets/claude-logo.svg" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=x.ai&sz=64" alt="Grok logo" width="16" valign="middle" /> Grok</kbd></a> &nbsp;
  <a href="https://cursor.com/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=cursor.com&sz=64" alt="Cursor logo" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://dev.meta.ai/docs/muse-code"><kbd><img src="src/shared/agent-icons/muse.png" alt="Muse logo" width="16" valign="middle" /> Muse</kbd></a> &nbsp;
  <a href="https://deepseek-harness.github.io/deepseek-harness/"><kbd><img src="src/shared/agent-icons/dsh.png" alt="DeepSeek Harness logo" width="16" valign="middle" /> DeepSeek Harness</kbd></a> &nbsp;
  <a href="https://zcode.z.ai/en/docs"><kbd><img src="src/shared/agent-icons/zcode.png" alt="ZCode logo" width="16" valign="middle" /> ZCode</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://mimo.xiaomi.com/coder"><kbd><img src="https://www.google.com/s2/favicons?domain=mimo.xiaomi.com&sz=64" alt="MiMo Code logo" width="16" valign="middle" /> MiMo Code</kbd></a> &nbsp;
  <a href="https://ampcode.com/manual#install"><kbd><img src="https://www.google.com/s2/favicons?domain=ampcode.com&sz=64" alt="Amp logo" width="16" valign="middle" /> Amp</kbd></a> &nbsp;
  <a href="https://openclaude.gitlawb.com/"><kbd><img src="resources/openclaude-logo.png" alt="OpenClaude logo" width="16" valign="middle" /> OpenClaude</kbd></a> &nbsp;
  <a href="https://antigravity.google/docs/cli-overview"><kbd><img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=64" alt="Antigravity logo" width="16" valign="middle" /> Antigravity</kbd></a> &nbsp;
  <a href="https://pi.dev"><kbd><img src="https://pi.dev/favicon.svg" alt="Pi logo" width="16" valign="middle" /> Pi</kbd></a> &nbsp;
  <a href="https://omp.sh"><kbd><img src="https://omp.sh/favicon.svg" alt="oh-my-pi logo" width="16" valign="middle" /> oh-my-pi</kbd></a> &nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/"><kbd><img src="https://www.google.com/s2/favicons?domain=nousresearch.com&sz=64" alt="Hermes Agent logo" width="16" valign="middle" /> Hermes Agent</kbd></a> &nbsp;
  <a href="https://devin.ai/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=devin.ai&sz=64" alt="Devin logo" width="16" valign="middle" /> Devin</kbd></a> &nbsp;
  <a href="https://goose-docs.ai/docs/quickstart/"><kbd><img src="https://www.google.com/s2/favicons?domain=goose-docs.ai&sz=64" alt="Goose logo" width="16" valign="middle" /> Goose</kbd></a> &nbsp;
  <a href="https://docs.augmentcode.com/cli/overview"><kbd><img src="https://www.google.com/s2/favicons?domain=augmentcode.com&sz=64" alt="Auggie logo" width="16" valign="middle" /> Auggie</kbd></a> &nbsp;
  <a href="https://github.com/autohandai/code-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=autohand.ai&sz=64" alt="Autohand Code logo" width="16" valign="middle" /> Autohand Code</kbd></a> &nbsp;
  <a href="https://github.com/charmbracelet/crush"><kbd><img src="https://www.google.com/s2/favicons?domain=charm.sh&sz=64" alt="Charm logo" width="16" valign="middle" /> Charm</kbd></a> &nbsp;
  <a href="https://docs.cline.bot/cline-cli/overview"><kbd><img src="https://www.google.com/s2/favicons?domain=cline.bot&sz=64" alt="Cline logo" width="16" valign="middle" /> Cline</kbd></a> &nbsp;
  <a href="https://www.codebuddy.ai/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=codebuddy.ai&sz=64" alt="CodeBuddy logo" width="16" valign="middle" /> CodeBuddy</kbd></a> &nbsp;
  <a href="https://www.codebuff.com/docs/help/quick-start"><kbd><img src="https://www.google.com/s2/favicons?domain=codebuff.com&sz=64" alt="Codebuff logo" width="16" valign="middle" /> Codebuff</kbd></a> &nbsp;
  <a href="https://freebuff.com"><kbd><img src="src/shared/agent-icons/freebuff.png" alt="Freebuff logo" width="16" valign="middle" /> Freebuff</kbd></a> &nbsp;
  <a href="https://commandcode.ai/docs/quickstart"><kbd><img src="https://www.google.com/s2/favicons?domain=commandcode.ai&sz=64" alt="Command Code logo" width="16" valign="middle" /> Command Code</kbd></a> &nbsp;
  <a href="https://docs.continue.dev/cli/quickstart"><kbd><img src="https://www.google.com/s2/favicons?domain=continue.dev&sz=64" alt="Continue logo" width="16" valign="middle" /> Continue</kbd></a> &nbsp;
  <a href="https://docs.factory.ai/cli/getting-started/quickstart"><kbd><img src="docs/assets/droid-logo.svg" alt="Droid logo" width="16" valign="middle" /> Droid</kbd></a> &nbsp;
  <a href="https://kilo.ai/docs/cli"><kbd><img src="https://raw.githubusercontent.com/Kilo-Org/kilocode/main/packages/kilo-vscode/assets/icons/kilo-light.svg" alt="Kilocode logo" width="16" valign="middle" /> Kilocode</kbd></a> &nbsp;
  <a href="https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html"><kbd><img src="https://www.google.com/s2/favicons?domain=moonshot.cn&sz=64" alt="Kimi logo" width="16" valign="middle" /> Kimi</kbd></a> &nbsp;
  <a href="https://kiro.dev/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=kiro.dev&sz=64" alt="Kiro logo" width="16" valign="middle" /> Kiro</kbd></a> &nbsp;
  <a href="https://github.com/mistralai/mistral-vibe"><kbd><img src="https://www.google.com/s2/favicons?domain=mistral.ai&sz=64" alt="Mistral Vibe logo" width="16" valign="middle" /> Mistral Vibe</kbd></a> &nbsp;
  <a href="https://github.com/QwenLM/qwen-code"><kbd><img src="https://www.google.com/s2/favicons?domain=qwenlm.github.io&sz=64" alt="Qwen Code logo" width="16" valign="middle" /> Qwen Code</kbd></a> &nbsp;
  <a href="https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/"><kbd><img src="https://www.google.com/s2/favicons?domain=atlassian.com&sz=64" alt="Rovo Dev logo" width="16" valign="middle" /> Rovo Dev</kbd></a> &nbsp;
  <kbd>+ any CLI agent</kbd>
</p>

---

## Install

### Desktop — macOS, Windows, Linux

- **[Download from onOrca.dev](https://onorca.dev/download)**
- Or grab a build directly: [macOS Apple Silicon](https://github.com/stablyai/orca/releases/latest/download/orca-macos-arm64.dmg) · [macOS Intel](https://github.com/stablyai/orca/releases/latest/download/orca-macos-x64.dmg) · [Windows (.exe)](https://github.com/stablyai/orca/releases/latest/download/orca-windows-setup.exe) · [Linux AppImage](https://github.com/stablyai/orca/releases/latest/download/orca-linux.AppImage) · [All builds](https://github.com/stablyai/orca/releases/latest)

_Or via a package manager:_

```bash
# macOS (Homebrew)
# Always use the full name; bare `orca` is an unrelated Plotly cask.
brew install --cask stablyai/orca/orca
# Upgrade an existing install
brew upgrade --cask stablyai/orca/orca
# Release candidates (conflicts with the stable cask; uninstall it first)
brew install --cask stablyai/orca/orca@rc

# Arch Linux (AUR) — or stably-orca-git to build from source
yay -S stably-orca-bin
```

### Mobile App — iOS, Android

Pair with your desktop app to monitor and steer your agents from your phone.

- **iOS:** [Download on the App Store](https://apps.apple.com/us/app/orca-ide/id6766130217)
- **Android:** [Download APK](https://www.onorca.dev/download/android) · [Install guide](https://www.onorca.dev/docs/android-apk)

---

## Community &amp; Support

- **Discord:** Join the community on **[Discord](https://discord.gg/fzjDKHxv8Q)**.
- **Twitter / X:** Follow **[@orca_build](https://x.com/orca_build)** for updates and announcements.
- **WeChat:** Scan to join an Orca community WeChat group.

  <img src="docs/assets/wechat-qr.jpg" alt="WeChat QR code for the Orca community" width="160" />

- **Feedback &amp; Ideas:** We ship fast. Missing something? [Request a new feature](https://github.com/stablyai/orca/issues).
- **Privacy:** See the [privacy &amp; telemetry docs](https://www.onorca.dev/docs/telemetry) for what anonymous usage data Orca collects and how to opt out.
- **Show Support:** [Star](https://github.com/stablyai/orca) this repo to follow along with our daily ships.

---

## Developing

Want to contribute or run locally? See our [CONTRIBUTING.md](.github/CONTRIBUTING.md) guide.

<a href="https://github.com/stablyai/orca/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stablyai/orca&max=500&columns=30" alt="Orca contributors" />
</a>

<p align="center">
  <img src="docs/assets/star-history.png" alt="GitHub star history chart for stablyai/orca" width="880" />
</p>

## Signed Builds

Windows code signing sponsored/provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## License

Orca is free and open source under the [MIT License](LICENSE).
