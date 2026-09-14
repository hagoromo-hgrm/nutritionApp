import { APP_VERSION, RELEASE_NOTES, type ReleaseNote } from '../generated/releaseNotes'

interface ReleaseNotesViewProps {
  onBack: () => void
}

function formatReleaseDate(releaseDate: string): string {
  const date = new Date(`${releaseDate}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return releaseDate
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function compareReleaseNotes(left: ReleaseNote, right: ReleaseNote): number {
  return right.releaseDate.localeCompare(left.releaseDate) || right.version.localeCompare(left.version, undefined, { numeric: true })
}

export function ReleaseNotesView({ onBack }: ReleaseNotesViewProps) {
  const releaseNotes = [...RELEASE_NOTES].sort(compareReleaseNotes)

  return <>
    <section className="page-heading release-notes-heading">
      <div>
        <button className="text-button release-notes-back" type="button" onClick={onBack}>← 設定</button>
        <span className="eyebrow">RELEASE NOTES</span>
        <h1>リリースノート</h1>
        <p className="muted">Nutrition PWA v{APP_VERSION}</p>
      </div>
    </section>

    <section className="release-notes-list" aria-label="リリースノート一覧">
      {releaseNotes.length === 0 ? <div className="empty-state release-notes-empty"><strong>公開済みのリリースノートはありません。</strong></div> : releaseNotes.map((note, index) => <details className="release-note-card" key={`${note.version}-${note.releaseDate}`} open={index === 0}>
        <summary className="release-note-summary">
          <span className="release-note-summary-copy"><strong>バージョン{note.version}</strong><small>{formatReleaseDate(note.releaseDate)}</small></span>
          <span className="release-note-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="release-note-body">
          <p className="release-note-summary-text">{note.summary}</p>
          {note.sections.map((section) => <section className="release-note-section" key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph, paragraphIndex) => <p key={`${section.heading}-paragraph-${paragraphIndex}`}>{paragraph}</p>)}
            <ul>{section.items.map((item, itemIndex) => <li key={`${section.heading}-${itemIndex}`}>{item}</li>)}</ul>
          </section>)}
        </div>
      </details>)}
    </section>
  </>
}
