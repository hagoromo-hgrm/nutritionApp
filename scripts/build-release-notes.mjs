import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const RELEASE_NOTE_HEADINGS = [
  '重要なお知らせ',
  '新機能',
  '改善',
  '不具合修正',
  '仕様変更',
  'データ・互換性',
  '既知の問題',
]

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const FRONTMATTER_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9]*): ("(?:\\.|[^"\\])*")$/
const ALLOWED_FRONTMATTER_KEYS = ['version', 'releaseDate', 'summary']
const MAX_NOTE_BYTES = 128 * 1024
const MAX_TOTAL_NOTE_BYTES = 1024 * 1024

function fail(sourceName, message) {
  throw new Error(`${sourceName}: ${message}`)
}

function validIsoDate(value) {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
}

function plainText(markdown) {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

function validateInlineMarkdown(value, sourceName, lineNumber) {
  const withoutAllowedFormatting = value
    .replace(/\*\*[^*\n]+\*\*/g, '')
    .replace(/`[^`\n]+`/g, '')
  if (['*', '`', '[', ']', '<', '>'].some((character) => withoutAllowedFormatting.includes(character)) || /https?:\/\//i.test(withoutAllowedFormatting)) {
    fail(sourceName, `許可されていないか閉じられていないMarkdownがあります（${lineNumber}行目）。`)
  }
}

function parseSections(lines, sourceName, firstLineIndex) {
  const sections = []
  let current = null
  let previousHeadingIndex = -1

  for (let index = firstLineIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '') continue
    if (line.startsWith('## ')) {
      if (current && current.items.length === 0) fail(sourceName, `空の見出し「${current.heading}」があります。`)
      const heading = line.slice(3)
      const headingIndex = RELEASE_NOTE_HEADINGS.indexOf(heading)
      if (headingIndex < 0) fail(sourceName, `許可されていない見出し「${heading}」があります。`)
      if (headingIndex <= previousHeadingIndex) fail(sourceName, '見出しの順序または重複が不正です。')
      current = { heading, paragraphs: [], items: [] }
      sections.push(current)
      previousHeadingIndex = headingIndex
      continue
    }
    if (!current) fail(sourceName, '分類見出しより前に本文があります。')
    if (!line.startsWith('- ')) {
      if (current.items.length > 0) fail(sourceName, `通常段落は箇条書きより前に置いてください（${index + 1}行目）。`)
      validateInlineMarkdown(line, sourceName, index + 1)
      current.paragraphs.push(plainText(line))
      continue
    }
    const item = line.slice(2).trim()
    if (!item) fail(sourceName, `空の箇条書きがあります（${index + 1}行目）。`)
    if (/!\[|\[[^\]]+\]\(|<[^>]+>|^\|/.test(item)) fail(sourceName, `許可されていないMarkdownがあります（${index + 1}行目）。`)
    validateInlineMarkdown(item, sourceName, index + 1)
    current.items.push(plainText(item))
  }

  if (current && current.items.length === 0) fail(sourceName, `空の見出し「${current.heading}」があります。`)
  return sections
}

export function parsePublishedReleaseNote(markdown, sourceName = 'release note') {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0] !== '---') fail(sourceName, 'ファイル先頭にフロントマターがありません。')
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) fail(sourceName, 'フロントマターが閉じられていません。')

  const metadata = {}
  for (const line of lines.slice(1, closingIndex)) {
    const match = FRONTMATTER_LINE_PATTERN.exec(line)
    if (!match) fail(sourceName, `フロントマターの形式が不正です: ${line}`)
    const [, key, encodedValue] = match
    if (!ALLOWED_FRONTMATTER_KEYS.includes(key)) fail(sourceName, `未知のフロントマターキー「${key}」があります。`)
    if (Object.hasOwn(metadata, key)) fail(sourceName, `フロントマターキー「${key}」が重複しています。`)
    try {
      metadata[key] = JSON.parse(encodedValue)
    } catch {
      fail(sourceName, `フロントマターキー「${key}」の文字列が不正です。`)
    }
  }
  for (const key of ALLOWED_FRONTMATTER_KEYS) {
    if (!Object.hasOwn(metadata, key)) fail(sourceName, `必須のフロントマターキー「${key}」がありません。`)
  }
  if (!VERSION_PATTERN.test(metadata.version)) fail(sourceName, 'versionがX.Y.Z形式ではありません。')
  if (!validIsoDate(metadata.releaseDate)) fail(sourceName, 'releaseDateが実在するYYYY-MM-DD形式の日付ではありません。')
  const summaryLength = [...metadata.summary].length
  if (metadata.summary.includes('\n') || summaryLength < 20 || summaryLength > 120) fail(sourceName, 'summaryは改行なしの20文字以上120文字以内にしてください。')
  if (!/[ぁ-んァ-ヶ一-龠々ー]/.test(metadata.summary)) fail(sourceName, 'summaryは日本語で記述してください。')

  let bodyIndex = closingIndex + 1
  while (lines[bodyIndex] === '') bodyIndex += 1
  if (lines[bodyIndex] !== `# バージョン${metadata.version}`) fail(sourceName, 'H1のバージョンがフロントマターと一致しません。')
  const sections = parseSections(lines, sourceName, bodyIndex + 1)
  if (sections.length === 0) fail(sourceName, '分類された変更項目がありません。')

  return { ...metadata, sections }
}

export function validateUnreleasedReleaseNote(markdown, sourceName = 'unreleased.md') {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0] !== '# 未公開') fail(sourceName, '先頭は「# 未公開」にしてください。')
  if (lines.some((line) => line === '---')) fail(sourceName, 'unreleased.mdにフロントマターは使用できません。')
  return parseSections(lines, sourceName, 1)
}

function compareVersionsDescending(left, right) {
  const leftParts = left.version.split('.').map(Number)
  const rightParts = right.version.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return rightParts[index] - leftParts[index]
  }
  return 0
}

export function renderReleaseNotesModule(version, notes) {
  return `// このファイルは npm run generate:release-notes で生成します。直接編集しないでください。\n\nexport interface ReleaseNoteSection {\n  heading: string\n  paragraphs: string[]\n  items: string[]\n}\n\nexport interface ReleaseNote {\n  version: string\n  releaseDate: string\n  summary: string\n  sections: ReleaseNoteSection[]\n}\n\nexport const APP_VERSION = ${JSON.stringify(version)}\n\nexport const RELEASE_NOTES: readonly ReleaseNote[] = ${JSON.stringify(notes, null, 2)}\n`
}

export async function buildReleaseNotes({ projectRoot, check = false } = {}) {
  const root = projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const notesDir = join(root, 'docs', 'releases')
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (typeof packageJson.version !== 'string' || !VERSION_PATTERN.test(packageJson.version)) fail('package.json', 'versionがX.Y.Z形式ではありません。')

  const directoryEntries = await readdir(notesDir, { withFileTypes: true })
  const unexpectedEntry = directoryEntries.find((entry) => !entry.isFile() || (entry.name !== 'unreleased.md' && !/^v\d+\.\d+\.\d+\.md$/.test(entry.name)))
  if (unexpectedEntry) fail(notesDir, `許可されていないファイル「${unexpectedEntry.name}」があります。`)
  const fileNames = directoryEntries.map((entry) => entry.name)
  if (!fileNames.includes('unreleased.md')) fail(notesDir, 'unreleased.mdがありません。')
  let totalBytes = 0
  const readNote = async (fileName) => {
    const bytes = await readFile(join(notesDir, fileName))
    if (bytes.byteLength > MAX_NOTE_BYTES) fail(fileName, 'ファイルサイズが128KiBを超えています。')
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_NOTE_BYTES) fail(notesDir, 'リリースノートの合計サイズが1MiBを超えています。')
    const markdown = bytes.toString('utf8')
    if (markdown.includes('\u0000') || markdown !== markdown.normalize('NFC')) fail(fileName, 'テキストはNULを含まないUTF-8 NFCで保存してください。')
    return markdown
  }
  validateUnreleasedReleaseNote(await readNote('unreleased.md'))

  const publishedFileNames = fileNames.filter((name) => /^v.+\.md$/.test(name)).sort()
  const notes = []
  const versions = new Set()
  for (const fileName of publishedFileNames) {
    const note = parsePublishedReleaseNote(await readNote(fileName), fileName)
    if (fileName !== `v${note.version}.md`) fail(fileName, 'ファイル名とフロントマターのversionが一致しません。')
    if (versions.has(note.version)) fail(fileName, `version ${note.version}が重複しています。`)
    versions.add(note.version)
    notes.push(note)
  }
  notes.sort(compareVersionsDescending)
  if (!versions.has(packageJson.version)) fail(notesDir, `現在版v${packageJson.version}.mdがありません。`)

  const output = renderReleaseNotesModule(packageJson.version, notes)
  const outputPath = join(root, 'src', 'generated', 'releaseNotes.ts')
  if (check) {
    let current = ''
    try { current = await readFile(outputPath, 'utf8') } catch { /* 不在も不一致として扱う。 */ }
    if (current !== output) fail(outputPath, '生成物が最新ではありません。npm run generate:release-notesを実行してください。')
    return { version: packageJson.version, notes }
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, output)
  return { version: packageJson.version, notes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildReleaseNotes({ check: process.argv.includes('--check') })
}
