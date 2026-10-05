@AGENTS.md

## 搜尋工具使用順序
- 結構性問題（呼叫關係、影響範圍、symbol 定義）→ 先用 codegraph
- 字串、檔名、非程式碼檔案 → 用 fff
- codegraph 查不到時才退回 fff，不要用內建 grep/glob
