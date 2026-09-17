import {
  addDays,
  enumerateDates,
  formatISODate,
  isISODate,
  parseISODate,
} from "@/lib/dates"

export const DEFAULT_PLAN_HORIZON_DAYS = 3
export const MAX_PLAN_HORIZON_DAYS = 21
export const PLAN_HORIZON_STORAGE_KEY = "cookbuddy.plan.horizonEnd"

export type PlanHorizon = {
  start: string
  end: string
  days: string[]
}

export function minPlanHorizonEnd(
  today = formatISODate(),
  minDays = DEFAULT_PLAN_HORIZON_DAYS
): string {
  return formatISODate(addDays(parseISODate(today), minDays - 1))
}

export function maxPlanHorizonEnd(
  today = formatISODate(),
  maxDays = MAX_PLAN_HORIZON_DAYS
): string {
  return formatISODate(addDays(parseISODate(today), maxDays - 1))
}

export function parseHorizonEnd(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null
  return isISODate(raw) ? raw : null
}

export function readHorizonEnd(
  storage: Pick<Storage, "getItem">
): string | null {
  return parseHorizonEnd(storage.getItem(PLAN_HORIZON_STORAGE_KEY))
}

export function writeHorizonEnd(
  storage: Pick<Storage, "setItem">,
  end: string
): void {
  storage.setItem(PLAN_HORIZON_STORAGE_KEY, end)
}

export function planHorizonStorage(): Pick<
  Storage,
  "getItem" | "setItem"
> | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    return null
  }
}

function laterDate(left: string, right: string): string {
  return left > right ? left : right
}

export function latestEntryDateOnOrAfter(
  entryDates: Iterable<string> | undefined,
  start: string
): string | null {
  let latest: string | null = null
  for (const date of entryDates ?? []) {
    if (!isISODate(date) || date < start) continue
    latest = latest == null ? date : laterDate(latest, date)
  }
  return latest
}

export function resolvePlanHorizon(input: {
  today?: string
  preferredEnd?: string | null
  entryDates?: Iterable<string>
  minDays?: number
  maxDays?: number
} = {}): PlanHorizon {
  const today = input.today ?? formatISODate()
  const minDays = input.minDays ?? DEFAULT_PLAN_HORIZON_DAYS
  const maxDays = input.maxDays ?? MAX_PLAN_HORIZON_DAYS
  const minEnd = minPlanHorizonEnd(today, minDays)
  const maxEnd = maxPlanHorizonEnd(today, maxDays)

  let end = minEnd
  const preferred = parseHorizonEnd(input.preferredEnd)
  if (preferred && preferred > end) {
    end = preferred > maxEnd ? maxEnd : preferred
  }

  const latestEntry = latestEntryDateOnOrAfter(input.entryDates, today)
  if (latestEntry && latestEntry > end) {
    end = latestEntry
  }

  return {
    start: today,
    end,
    days: enumerateDates(today, end),
  }
}

export function addPlanHorizonDay(end: string, days = 1): string {
  return formatISODate(addDays(parseISODate(end), days))
}

export function canExtendPlanHorizon(input: {
  end: string
  today?: string
  maxDays?: number
}): boolean {
  const today = input.today ?? formatISODate()
  const maxEnd = maxPlanHorizonEnd(today, input.maxDays)
  return input.end < maxEnd
}

export function collapsePlanHorizonEnd(input: {
  today?: string
  currentEnd: string
  entryDates?: Iterable<string>
  minDays?: number
}): string {
  const today = input.today ?? formatISODate()
  const minEnd = minPlanHorizonEnd(today, input.minDays)
  const latestEntry = latestEntryDateOnOrAfter(input.entryDates, today)
  const lastNeeded =
    latestEntry && latestEntry > minEnd && latestEntry <= input.currentEnd
      ? latestEntry
      : minEnd
  return lastNeeded < input.currentEnd ? lastNeeded : input.currentEnd
}

export function canCollapsePlanHorizon(input: {
  today?: string
  currentEnd: string
  entryDates?: Iterable<string>
  minDays?: number
}): boolean {
  return collapsePlanHorizonEnd(input) < input.currentEnd
}
