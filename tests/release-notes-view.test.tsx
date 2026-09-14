import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReleaseNotesView } from '../src/components/ReleaseNotesView'
import { APP_VERSION, RELEASE_NOTES } from '../src/generated/releaseNotes'

describe('release notes view', () => {
  it('現在版と公開済みノートだけを利用者向けの文字列として表示する', () => {
    const html = renderToStaticMarkup(<ReleaseNotesView onBack={() => undefined} />)

    expect(APP_VERSION).toBe('0.2.0')
    expect(RELEASE_NOTES).toHaveLength(1)
    expect(html).toContain('Nutrition PWA v0.2.0')
    expect(html).toContain('バージョン0.2.0')
    expect(html).toContain('リリースノート')
    expect(html).toContain('既存の食品、食事記録、設定、バックアップ形式は変更されません。')
    expect(html).not.toContain('未公開')
    expect(html).not.toContain('<script')
  })
})
