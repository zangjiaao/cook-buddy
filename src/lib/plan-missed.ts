import { isPlanEntryCooked } from "@/lib/cook-complete"
import {
  addDays,
  formatISODate,
  isISODate,
  parseISODate,
  prettyDate,
} from "@/lib/dates"
import type { PlanEntry } from "@/lib/types"

export function isMissedPlanEntry(entry: PlanEntry, today: string): boolean {
  return (
    isISODate(entry.date) && entry.date < today && !isPlanEntryCooked(entry)
  )
}

export function missedPlanEntries(
  entries: PlanEntry[],
  today: string
): PlanEntry[] {
  return entries
    .filter((entry) => isMissedPlanEntry(entry, today))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id)
    )
}

export function missedPlanHint(
  entries: PlanEntry[],
  today: string
): string | null {
  const missed = missedPlanEntries(entries, today)
  if (missed.length === 0) return null
  const yesterday = formatISODate(addDays(parseISODate(today), -1))
  const prefix = missed.every((entry) => entry.date === yesterday)
    ? "昨天"
    : "过去"
  return `${prefix}有 ${missed.length} 道没做`
}

export function missedDayLabel(date: string, today: string): string {
  const yesterday = formatISODate(addDays(parseISODate(today), -1))
  if (date === yesterday) return "昨天"
  return prettyDate(date, today)
}
