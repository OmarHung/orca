import { describe, expect, it } from 'vitest'
import {
  buildForkChangelogPrompt,
  cleanGeneratedChangelog,
  describeSummaryLanguage
} from './fork-update-changelog-prompt'

const note = (tag: string, body: string) => ({
  tag,
  title: `Orca ${tag.slice(1)}`,
  url: `https://github.com/stablyai/orca/releases/tag/${tag}`,
  publishedAt: '2026-10-02T08:00:00Z',
  body
})

describe('describeSummaryLanguage', () => {
  it('spells out the Chinese script and regional wording', () => {
    expect(describeSummaryLanguage('zh-TW')).toContain('Traditional Chinese as written in Taiwan')
    expect(describeSummaryLanguage('zh-Hant-HK')).toContain('Traditional Chinese')
    expect(describeSummaryLanguage('zh')).toContain('Simplified Chinese')
    expect(describeSummaryLanguage('zh-CN')).toContain('Simplified Chinese')
  })

  it('names other languages in English with their tag', () => {
    expect(describeSummaryLanguage('ja')).toBe('Japanese (ja)')
    expect(describeSummaryLanguage('en')).toBe('English (en)')
  })

  it('falls back to the tag for an unknown language', () => {
    expect(describeSummaryLanguage('xx-invalid-tag-')).toContain('"xx-invalid-tag-"')
  })
})

describe('buildForkChangelogPrompt', () => {
  it('includes the versions, the language, every release and the fork commits', () => {
    const prompt = buildForkChangelogPrompt({
      fromTag: 'v1.4.217',
      toTag: 'v1.4.219',
      releaseNotes: [note('v1.4.219', '- Sparse presets'), note('v1.4.218', '- Codex servers')],
      forkCommits: [{ sha: 'abc', subject: 'feat: changelog dialog' }],
      locale: 'zh-TW'
    })
    expect(prompt).toContain('from v1.4.217 to v1.4.219')
    expect(prompt).toContain('Traditional Chinese as written in Taiwan')
    expect(prompt).toContain('### Orca 1.4.219 (v1.4.219, 2026-10-02)\n- Sparse presets')
    expect(prompt).toContain('- Codex servers')
    expect(prompt).toContain('<fork_commits>\n- feat: changelog dialog\n</fork_commits>')
    expect(prompt).toContain('untrusted data')
  })

  it('says when the fork commits could not be compared', () => {
    const prompt = buildForkChangelogPrompt({
      fromTag: 'v1.4.218',
      toTag: 'v1.4.219',
      releaseNotes: [],
      forkCommits: null,
      locale: 'en'
    })
    expect(prompt).toContain('No upstream release notes were available.')
    expect(prompt).toContain('Unknown: the previous build could not be compared.')
  })

  it('omits the oldest releases past the length cap', () => {
    const long = 'x'.repeat(40_000)
    const prompt = buildForkChangelogPrompt({
      fromTag: 'v1.4.216',
      toTag: 'v1.4.219',
      releaseNotes: [note('v1.4.219', long), note('v1.4.218', long), note('v1.4.217', long)],
      forkCommits: [],
      locale: 'en'
    })
    expect(prompt).toContain('v1.4.219')
    expect(prompt).not.toContain('(v1.4.218,')
    expect(prompt).toContain('2 older release(s) omitted for length.')
  })
})

describe('cleanGeneratedChangelog', () => {
  it('unwraps a Markdown code fence and trims', () => {
    expect(cleanGeneratedChangelog('\n```markdown\n## Fixes\n- One\n```\n')).toBe('## Fixes\n- One')
    expect(cleanGeneratedChangelog('  ## Fixes  ')).toBe('## Fixes')
  })
})
