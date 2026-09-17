export function formatISODate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function daysUntil(isoDate: string, today = formatISODate()): number {
  const ms = parseISODate(isoDate).getTime() - parseISODate(today).getTime()
  return Math.round(ms / 86_400_000)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function weekdayLabel(isoDate: string): string {
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
  return labels[parseISODate(isoDate).getDay()] ?? ""
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return formatISODate(parseISODate(value)) === value
}

export function formatMonthDay(isoDate: string): string {
  const date = parseISODate(isoDate)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function enumerateDates(startIso: string, endIso: string): string[] {
  if (endIso < startIso) return []
  const days: string[] = []
  let current = parseISODate(startIso)
  const end = parseISODate(endIso)
  while (current.getTime() <= end.getTime()) {
    days.push(formatISODate(current))
    current = addDays(current, 1)
  }
  return days
}

export function prettyDate(isoDate: string, today = formatISODate()): string {
  const offset = daysUntil(isoDate, today)
  if (offset === 0) return "今天"
  if (offset === 1) return "明天"
  if (offset === 2) return "后天"
  return formatMonthDay(isoDate)
}
