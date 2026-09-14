import { describe, expect, it } from 'vitest'
import {
  parsePublishedReleaseNote,
  renderReleaseNotesModule,
  validateUnreleasedReleaseNote,
} from '../scripts/build-release-notes.mjs'

const validNote = `---
version: "0.2.0"
releaseDate: "2026-09-14"
summary: "設定画面から公開済みの更新内容を確認できるようになりました。"
---

# バージョン0.2.0

## 新機能

設定画面から更新内容を確認できます。

- **設定**: \`リリースノート\`を表示できるようになりました。

## データ・互換性

- 既存データとバックアップ形式は変更されません。
`

describe('release note build input', () => {
  it('固定書式を検証して安全な表示用文字列へ変換する', () => {
    const parsed = parsePublishedReleaseNote(validNote, 'v0.2.0.md')
    expect(parsed).toMatchObject({ version: '0.2.0', releaseDate: '2026-09-14' })
    expect(parsed.sections).toEqual([
      { heading: '新機能', paragraphs: ['設定画面から更新内容を確認できます。'], items: ['設定: リリースノートを表示できるようになりました。'] },
      { heading: 'データ・互換性', paragraphs: [], items: ['既存データとバックアップ形式は変更されません。'] },
    ])
    expect(renderReleaseNotesModule(parsed.version, [parsed])).not.toContain('**')
  })

  it('不正な日付、見出し順、リンク、空見出しを拒否する', () => {
    expect(() => parsePublishedReleaseNote(validNote.replace('2026-09-14', '2026-02-30'))).toThrow('releaseDate')
    expect(() => parsePublishedReleaseNote(validNote.replace('## 新機能', '## 既知の問題'))).toThrow('順序')
    expect(() => parsePublishedReleaseNote(validNote.replace('`リリースノート`', '[リリースノート](https://example.com)'))).toThrow('Markdown')
    expect(() => parsePublishedReleaseNote(validNote.replace('- **設定**: `リリースノート`を表示できるようになりました。', ''))).toThrow('空の見出し')
  })

  it('未公開ノートはフロントマターなしの固定見出しだけを許可する', () => {
    expect(validateUnreleasedReleaseNote('# 未公開\n')).toEqual([])
    expect(validateUnreleasedReleaseNote('# 未公開\n\n## 改善\n\n- 入力操作を見直しました。')).toEqual([
      { heading: '改善', paragraphs: [], items: ['入力操作を見直しました。'] },
    ])
    expect(() => validateUnreleasedReleaseNote('---\n# 未公開')).toThrow()
  })

  it('日本語ではない要約と箇条書き後の通常段落を拒否する', () => {
    expect(() => parsePublishedReleaseNote(validNote.replace('設定画面から公開済みの更新内容を確認できるようになりました。', 'This release summary has enough characters.'))).toThrow('日本語')
    expect(() => parsePublishedReleaseNote(validNote.replace('- **設定**: `リリースノート`を表示できるようになりました。', '- **設定**: `リリースノート`を表示できるようになりました。\n後置きの段落です。'))).toThrow('箇条書きより前')
  })
})
