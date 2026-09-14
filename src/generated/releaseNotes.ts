// このファイルは npm run generate:release-notes で生成します。直接編集しないでください。

export interface ReleaseNoteSection {
  heading: string
  paragraphs: string[]
  items: string[]
}

export interface ReleaseNote {
  version: string
  releaseDate: string
  summary: string
  sections: ReleaseNoteSection[]
}

export const APP_VERSION = "0.2.0"

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    "version": "0.2.0",
    "releaseDate": "2026-09-14",
    "summary": "食品とメニューの単位入力、過去の目標量表示を改善し、更新内容をアプリ内で確認できるようになりました。",
    "sections": [
      {
        "heading": "新機能",
        "paragraphs": [],
        "items": [
          "設定: 「リリースノート」から、公開日ごとの新機能、改善、不具合修正、データへの影響を確認できるようになりました。",
          "Myメニュー: メニュー全体の単位を「食」に固定せず、「個」「皿」など任意の単位で登録できるようになりました。"
        ]
      },
      {
        "heading": "改善",
        "paragraphs": [],
        "items": [
          "食品登録: 食品に登録済みの入力単位を、編集画面から変更・削除できるようになりました。"
        ]
      },
      {
        "heading": "不具合修正",
        "paragraphs": [],
        "items": [
          "栄養目標: 年齢や体重などを更新して目標量が変わっても、過去の日付には当時の目標量が表示されるよう修正しました。"
        ]
      },
      {
        "heading": "仕様変更",
        "paragraphs": [],
        "items": [
          "食事区分の確認: 画面左上の「今日の記録へ」を削除し、画面下部の操作へ統一しました。"
        ]
      },
      {
        "heading": "データ・互換性",
        "paragraphs": [],
        "items": [
          "既存の食品、食事記録、設定、バックアップ形式は変更されません。過去の食事記録と目標量履歴は保持され、更新前の追加操作は不要です。"
        ]
      }
    ]
  }
]
