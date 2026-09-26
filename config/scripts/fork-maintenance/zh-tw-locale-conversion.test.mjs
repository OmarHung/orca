import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyTermOverrides, convertCatalog, formatCatalog } from './zh-tw-locale-conversion.mjs'

const overrides = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'zh-tw-term-overrides.json'), 'utf8')
)

describe('applyTermOverrides', () => {
  it('fixes the Mainland-style UI terms OpenCC leaves behind', () => {
    expect(applyTermOverrides('在新終端中啟動智慧體', overrides)).toBe('在新終端機中啟動代理')
    expect(applyTermOverrides('此操作無法撤銷。', overrides)).toBe('此操作無法復原。')
    expect(applyTermOverrides('切換標籤頁', overrides)).toBe('切換分頁')
    expect(applyTermOverrides('請求評審人', overrides)).toBe('請求審查者')
    expect(applyTermOverrides('建立配置檔案失敗', overrides)).toBe('建立設定檔失敗')
    expect(applyTermOverrides('新增配置…', overrides)).toBe('新增設定…')
  })

  it('reads 通過 as "via" unless it means a check passed', () => {
    expect(applyTermOverrides('流量通過 SSH 主機', overrides)).toBe('流量透過 SSH 主機')
    expect(applyTermOverrides('Orca 會通過標準輸入傳遞', overrides)).toBe('Orca 會透過標準輸入傳遞')
    for (const passed of ['檢查已通過', '14 次通過，1 次跳過', '所有檢查均通過', '通過']) {
      expect(applyTermOverrides(passed, overrides)).toBe(passed)
    }
  })

  it('does not double a term that is already correct or reword other meanings', () => {
    expect(applyTermOverrides('終端機', overrides)).toBe('終端機')
    // Why kept: here 撤銷 means revoking a link, not undoing.
    expect(applyTermOverrides('撤銷會阻止將來的存取', overrides)).toBe('撤銷會阻止將來的存取')
  })
})

describe('convertCatalog', () => {
  it('converts every string and keeps keys, nesting and placeholders', () => {
    const catalog = { a: { b: '{{count}} 个文件' }, c: 'x', n: 3 }
    expect(convertCatalog(catalog, (text) => text.replace('个文件', '個檔案'))).toEqual({
      a: { b: '{{count}} 個檔案' },
      c: 'x',
      n: 3
    })
  })

  it('formats like the other catalogs', () => {
    expect(formatCatalog({ a: '中' })).toBe('{\n  "a": "中"\n}\n')
  })
})
