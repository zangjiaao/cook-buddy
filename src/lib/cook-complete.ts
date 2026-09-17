import type { DeductSnapshot, PlanEntry, PlanEntryStatus } from "@/lib/types"

export type LegacyPlanEntry = Omit<
  PlanEntry,
  "status" | "cookedAt" | "lastDeduct"
> & {
  status?: PlanEntryStatus
  cookedAt?: string | null
  lastDeduct?: DeductSnapshot | null
}

export function isPlanEntryCooked(
  entry: Pick<PlanEntry, "status" | "cookedAt"> | null | undefined
): boolean {
  if (!entry) return false
  return entry.status === "cooked" || entry.cookedAt != null
}

export function canDeduct(
  entry: Pick<PlanEntry, "status" | "cookedAt"> | null | undefined
): boolean {
  return Boolean(entry) && !isPlanEntryCooked(entry)
}

export function canUndoDeduct(
  entry: PlanEntry | null | undefined,
  snapshot?: DeductSnapshot | null
): boolean {
  if (!entry || !isPlanEntryCooked(entry)) return false
  return Boolean(entry.lastDeduct ?? snapshot)
}

export function normalizePlanEntry(entry: LegacyPlanEntry): PlanEntry {
  const lastDeduct = entry.lastDeduct ?? null
  const cookedAt = entry.cookedAt ?? lastDeduct?.at ?? null
  const status: PlanEntryStatus =
    entry.status === "cooked" || cookedAt != null ? "cooked" : "planned"
  return {
    id: entry.id,
    date: entry.date,
    rangeKey: entry.rangeKey ?? null,
    recipeId: entry.recipeId,
    servings: entry.servings,
    sortOrder: entry.sortOrder,
    status,
    cookedAt: status === "cooked" ? cookedAt : null,
    lastDeduct: status === "cooked" ? lastDeduct : null,
  }
}

export function applyCookedState(
  entry: LegacyPlanEntry,
  snapshot: DeductSnapshot
): PlanEntry {
  return {
    ...normalizePlanEntry(entry),
    status: "cooked",
    cookedAt: snapshot.at,
    lastDeduct: snapshot,
  }
}

export function clearCookedState(entry: LegacyPlanEntry): PlanEntry {
  return {
    ...normalizePlanEntry(entry),
    status: "planned",
    cookedAt: null,
    lastDeduct: null,
  }
}

export function planEntryNeedsMigrate(entry: LegacyPlanEntry): boolean {
  const next = normalizePlanEntry(entry)
  return (
    entry.status !== next.status ||
    (entry.cookedAt ?? null) !== next.cookedAt ||
    (entry.lastDeduct ?? null) !== next.lastDeduct
  )
}

export function uncookedPlanEntries(entries: LegacyPlanEntry[]): PlanEntry[] {
  return entries
    .map(normalizePlanEntry)
    .filter((entry) => !isPlanEntryCooked(entry))
}

export function isSameDeductSnapshot(
  left: DeductSnapshot | null | undefined,
  right: DeductSnapshot | null | undefined
): boolean {
  if (!left || !right) return false
  return left.at === right.at && left.planEntryId === right.planEntryId
}
