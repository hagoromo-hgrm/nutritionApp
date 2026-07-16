const TOKYO_TIME_ZONE = 'Asia/Tokyo'

export function formatDateKey(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

export function currentDateKey(): string {
  return formatDateKey(new Date())
}

export function currentMonthRange(): { from: string; to: string } {
  const today = currentDateKey()
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+09:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDateKey(date)
}

export function dateKeyToIso(dateKey: string, hour = 12): string {
  return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:00:00+09:00`).toISOString()
}

export function toTokyoDateTimeInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function toTokyoTimeInput(iso: string): string {
  return toTokyoDateTimeInput(iso).slice(11, 16)
}

export function defaultDateTimeInput(dateKey: string): string {
  const today = currentDateKey()
  return dateKey === today ? toTokyoDateTimeInput(new Date().toISOString()) : `${dateKey}T12:00`
}

export function isoFromTokyoDateTimeInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00+09:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function isoFromTokyoTimeInput(dateKey: string, value: string): string | null {
  return isoFromTokyoDateTimeInput(`${dateKey}T${value}`)
}

export function formatFileTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`
}
