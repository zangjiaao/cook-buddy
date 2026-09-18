import {
  clampDishesPerDay,
  DEFAULT_DISHES_PER_DAY,
  DEFAULT_PLAN_DRAFT_PRIORITIES,
  PLAN_DRAFT_DAY_PRESETS,
  sanitizeExtraRequirements,
  sanitizePlanDraftPriorities,
} from "@/lib/plan-draft"
import type {
  PlanDraftFillStrategy,
  PlanDraftPriority,
  PlanDraftRange,
} from "@/lib/plan-draft"

export const PLAN_DRAFT_PREFS_STORAGE_KEY = "cookbuddy.plan.draftPrefs"

export type PlanDraftPrefs = {
  range: PlanDraftRange
  dishesPerDay: number
  fillStrategy: PlanDraftFillStrategy
  extraRequirements: string
  priorities: PlanDraftPriority[]
}

export const DEFAULT_PLAN_DRAFT_PREFS: PlanDraftPrefs = {
  range: { type: "horizon" },
  dishesPerDay: DEFAULT_DISHES_PER_DAY,
  fillStrategy: "empty",
  extraRequirements: "",
  priorities: [...DEFAULT_PLAN_DRAFT_PRIORITIES],
}

function clonePrefs(prefs: PlanDraftPrefs): PlanDraftPrefs {
  return {
    range:
      prefs.range.type === "days"
        ? { type: "days", days: prefs.range.days }
        : { type: "horizon" },
    dishesPerDay: prefs.dishesPerDay,
    fillStrategy: prefs.fillStrategy,
    extraRequirements: prefs.extraRequirements,
    priorities: [...prefs.priorities],
  }
}

function parseRange(raw: unknown): PlanDraftRange {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: "horizon" }
  }
  const record = raw as { type?: unknown; days?: unknown }
  if (record.type === "days") {
    const days = Number(record.days)
    if ((PLAN_DRAFT_DAY_PRESETS as readonly number[]).includes(days)) {
      return { type: "days", days }
    }
  }
  return { type: "horizon" }
}

export function parsePlanDraftPrefs(
  raw: string | null | undefined
): PlanDraftPrefs {
  if (raw == null || raw === "") return clonePrefs(DEFAULT_PLAN_DRAFT_PREFS)
  try {
    const record = JSON.parse(raw) as unknown
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return clonePrefs(DEFAULT_PLAN_DRAFT_PREFS)
    }
    const row = record as Record<string, unknown>
    return {
      range: parseRange(row.range),
      dishesPerDay: clampDishesPerDay(row.dishesPerDay),
      fillStrategy: row.fillStrategy === "replace" ? "replace" : "empty",
      extraRequirements: sanitizeExtraRequirements(row.extraRequirements),
      priorities: sanitizePlanDraftPriorities(row.priorities),
    }
  } catch {
    return clonePrefs(DEFAULT_PLAN_DRAFT_PREFS)
  }
}

export function serializePlanDraftPrefs(prefs: PlanDraftPrefs): string {
  return JSON.stringify({
    range:
      prefs.range.type === "days"
        ? { type: "days", days: prefs.range.days }
        : { type: "horizon" },
    dishesPerDay: clampDishesPerDay(prefs.dishesPerDay),
    fillStrategy: prefs.fillStrategy === "replace" ? "replace" : "empty",
    extraRequirements: sanitizeExtraRequirements(prefs.extraRequirements),
    priorities: sanitizePlanDraftPriorities(prefs.priorities),
  })
}

export function readPlanDraftPrefs(
  storage: Pick<Storage, "getItem"> | null
): PlanDraftPrefs {
  if (!storage) return clonePrefs(DEFAULT_PLAN_DRAFT_PREFS)
  return parsePlanDraftPrefs(storage.getItem(PLAN_DRAFT_PREFS_STORAGE_KEY))
}

export function writePlanDraftPrefs(
  storage: Pick<Storage, "setItem"> | null,
  prefs: PlanDraftPrefs
): void {
  storage?.setItem(PLAN_DRAFT_PREFS_STORAGE_KEY, serializePlanDraftPrefs(prefs))
}

export function planDraftPrefsStorage(): Pick<
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
