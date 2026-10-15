import { extractJsonObject } from "@/lib/ai/parse-recipe"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { classifyByRules, guessCategory } from "@/lib/ingredient-category"
import type { Category } from "@/lib/types"
import { CATEGORIES } from "@/lib/types"

export type ClassifiedName = {
  name: string
  category: Category
  source: "rule" | "ai" | "fallback"
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function readCategoryValue(value: unknown): Category | null {
  if (typeof value !== "string") return null
  return (CATEGORIES as readonly string[]).includes(value)
    ? (value as Category)
    : null
}

export function classifyNamesLocal(names: string[]): ClassifiedName[] {
  return names.map((raw) => {
    const name = raw.trim()
    const ruled = classifyByRules(name)
    if (ruled) return { name, category: ruled, source: "rule" }
    return { name, category: guessCategory(name), source: "fallback" }
  })
}

export function namesNeedingAi(rows: ClassifiedName[]): string[] {
  return rows
    .filter((row) => row.source === "fallback" && row.name)
    .map((row) => row.name)
}

export function parseClassifyResponse(
  text: string
): Map<string, Category> | null {
  try {
    const parsed = extractJsonObject(text)
    const record = asRecord(parsed)
    const list = Array.isArray(record?.results)
      ? record.results
      : Array.isArray(parsed)
        ? parsed
        : null
    if (!list) return null
    const byName = new Map<string, Category>()
    for (const entry of list) {
      const row = asRecord(entry)
      const name = String(row?.name ?? row?.rawName ?? "").trim()
      const category = readCategoryValue(row?.category)
      if (!name || !category) continue
      byName.set(normalizeIngredientName(name), category)
    }
    return byName.size > 0 ? byName : null
  } catch {
    return null
  }
}

export function mergeClassifications(
  local: ClassifiedName[],
  aiByName: Map<string, Category> | null
): ClassifiedName[] {
  if (!aiByName) return local
  return local.map((row) => {
    if (row.source === "rule") return row
    const category = aiByName.get(normalizeIngredientName(row.name))
    if (!category) return row
    return { name: row.name, category, source: "ai" }
  })
}
