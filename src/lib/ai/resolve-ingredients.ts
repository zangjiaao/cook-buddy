import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { extractJsonObject } from "@/lib/ai/parse-recipe"
import { MARKET_UNITS } from "@/lib/labels"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { stallFromCategory } from "@/lib/shopping-from-plan"
import type { Category, Location, StallHint } from "@/lib/types"
import { CATEGORIES, LOCATIONS } from "@/lib/types"

export type IngredientSnapshot = {
  id: string
  name: string
  aliases: string[]
  category: Category
  defaultUnit: string
  stallHint: StallHint
  defaultShelfLifeDays: number | null
}

export type ResolveInputItem = {
  rawName: string
  unit?: string
  ingredientId?: string | null
}

export type IngredientCreateDraft = {
  name: string
  aliases: string[]
  category: Category
  defaultUnit: string
  stallHint: StallHint
  defaultShelfLifeDays: number | null
  defaultLocation?: Location
}

export type ResolveCandidate = {
  ingredientId: string
  name: string
  reason?: string
}

export type ResolveAction = "link" | "create" | "needs_confirm"

export type IngredientResolveResult = {
  rawName: string
  action: ResolveAction
  ingredientId?: string
  createDraft?: IngredientCreateDraft
  candidates?: ResolveCandidate[]
  source: "rule" | "ai" | "fallback"
}

export type ResolveIngredientsInput = {
  items: ResolveInputItem[]
  ingredients: IngredientSnapshot[]
}

export type ConfirmChoice =
  { action: "link"; ingredientId: string } | { action: "create" }

const FUZZY_UNITS = /^(少许|适量|若干)$/
const SEASONING_RE =
  /抽|酱油|醋|盐|糖|料酒|蚝油|酱|食用油|花椒|胡椒|味精|鸡精|八角|桂皮|香叶|豆瓣/
const MEAT_RE = /肉|猪|牛|羊|鸡|鸭|排骨|五花|虾|鱼|肋排|翅|里脊|肥肠/
const EGG_RE = /蛋/
const DRY_RE = /粉丝|粉条|面条|挂面|大米|木耳|香菇|腐竹|淀粉|面粉|豆腐干/
const GARLIC_RE = /^(蒜|大蒜|蒜瓣|蒜蓉)$/

export function toIngredientSnapshot(
  ingredient: IngredientSnapshot
): IngredientSnapshot {
  return {
    id: ingredient.id,
    name: ingredient.name,
    aliases: ingredient.aliases,
    category: ingredient.category,
    defaultUnit: ingredient.defaultUnit,
    stallHint: ingredient.stallHint,
    defaultShelfLifeDays: ingredient.defaultShelfLifeDays,
  }
}

export function findExactIngredient(
  rawName: string,
  ingredients: IngredientSnapshot[]
): IngredientSnapshot | undefined {
  const needle = normalizeIngredientName(rawName)
  if (!needle) return undefined
  return ingredients.find((ingredient) => {
    if (normalizeIngredientName(ingredient.name) === needle) return true
    return ingredient.aliases.some(
      (alias) => normalizeIngredientName(alias) === needle
    )
  })
}

export function guessCategory(rawName: string): Category {
  const name = rawName.trim()
  if (SEASONING_RE.test(name) || GARLIC_RE.test(name)) return "seasoning"
  if (MEAT_RE.test(name) || EGG_RE.test(name)) return "meat"
  if (DRY_RE.test(name)) return "dry"
  return "veg"
}

export function guessDefaultLocation(category: Category): Location {
  if (category === "dry" || category === "seasoning") return "pantry"
  return "fridge"
}

export function guessDefaultUnit(
  rawName: string,
  category: Category,
  unitHint?: string
): string {
  const hint = unitHint?.trim() ?? ""
  if (hint && !FUZZY_UNITS.test(hint)) return hint
  if (category === "meat") return "斤"
  if (category === "seasoning") {
    if (/抽|油|酱|醋|料酒/.test(rawName)) return "瓶"
    return "勺"
  }
  if (category === "dry") return "袋"
  if (/豆腐/.test(rawName)) return "盒"
  if (/番茄|土豆|蛋|苹果|梨/.test(rawName)) return "个"
  return "把"
}

export function fallbackCreateDraft(
  rawName: string,
  unitHint?: string
): IngredientCreateDraft {
  const name = rawName.trim() || "未命名食材"
  const category = guessCategory(name)
  return {
    name,
    aliases: [],
    category,
    defaultUnit: guessDefaultUnit(name, category, unitHint),
    stallHint: stallFromCategory(category),
    defaultShelfLifeDays: CATEGORY_SHELF_LIFE_DAYS[category],
    defaultLocation: guessDefaultLocation(category),
  }
}

export function resolveIngredientsLocal(
  input: ResolveIngredientsInput
): IngredientResolveResult[] {
  return input.items.map((item) => resolveItemByRules(item, input.ingredients))
}

export function resolveItemByRules(
  item: ResolveInputItem,
  ingredients: IngredientSnapshot[]
): IngredientResolveResult {
  const rawName = item.rawName.trim() || "未命名食材"
  if (item.ingredientId) {
    const existing = ingredients.find(
      (ingredient) => ingredient.id === item.ingredientId
    )
    if (existing) {
      return {
        rawName,
        action: "link",
        ingredientId: existing.id,
        source: "rule",
      }
    }
  }

  const exact = findExactIngredient(rawName, ingredients)
  if (exact) {
    return {
      rawName,
      action: "link",
      ingredientId: exact.id,
      source: "rule",
    }
  }

  return {
    rawName,
    action: "create",
    createDraft: fallbackCreateDraft(rawName, item.unit),
    source: "fallback",
  }
}

export function itemsNeedingAi(
  input: ResolveIngredientsInput,
  ruled: IngredientResolveResult[]
): ResolveInputItem[] {
  return input.items.filter((_, index) => ruled[index]?.source !== "rule")
}

export function applyConfirmChoice(
  result: IngredientResolveResult,
  choice: ConfirmChoice
): IngredientResolveResult {
  if (choice.action === "link") {
    return {
      ...result,
      action: "link",
      ingredientId: choice.ingredientId,
    }
  }
  return {
    ...result,
    action: "create",
    createDraft: result.createDraft ?? fallbackCreateDraft(result.rawName),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readAction(value: unknown): ResolveAction | null {
  if (value === "link" || value === "create" || value === "needs_confirm") {
    return value
  }
  return null
}

function readCategory(value: unknown): Category | null {
  if (typeof value !== "string") return null
  return (CATEGORIES as readonly string[]).includes(value)
    ? (value as Category)
    : null
}

function readLocation(value: unknown): Location | undefined {
  if (typeof value !== "string") return undefined
  return (LOCATIONS as readonly string[]).includes(value)
    ? (value as Location)
    : undefined
}

function readStallHint(value: unknown, category: Category): StallHint {
  if (value === "meat" || value === "veg" || value === "dry") return value
  if (value === null) return null
  return stallFromCategory(category)
}

function readAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((alias) => String(alias).trim())
    .filter(Boolean)
    .filter((alias, index, all) => all.indexOf(alias) === index)
}

function readUnit(value: unknown, fallback: string): string {
  const unit = String(value ?? "").trim()
  if (!unit) return fallback
  if (MARKET_UNITS.includes(unit) || FUZZY_UNITS.test(unit)) return unit
  return unit
}

function readShelfDays(value: unknown, fallback: number): number | null {
  if (value == null || value === "") return fallback
  const days = Number(value)
  if (!Number.isFinite(days) || days < 0) return fallback
  return Math.round(days)
}

export function normalizeCreateDraft(
  raw: unknown,
  rawName: string,
  unitHint?: string
): IngredientCreateDraft {
  const fallback = fallbackCreateDraft(rawName, unitHint)
  const record = asRecord(raw)
  if (!record) return fallback

  const name = String(record.name ?? rawName).trim() || fallback.name
  const category = readCategory(record.category) ?? fallback.category
  const aliases = readAliases(record.aliases).filter(
    (alias) => normalizeIngredientName(alias) !== normalizeIngredientName(name)
  )
  return {
    name,
    aliases,
    category,
    defaultUnit: readUnit(record.defaultUnit, fallback.defaultUnit),
    stallHint: readStallHint(record.stallHint, category),
    defaultShelfLifeDays: readShelfDays(
      record.defaultShelfLifeDays,
      fallback.defaultShelfLifeDays ?? CATEGORY_SHELF_LIFE_DAYS[category]
    ),
    defaultLocation:
      readLocation(record.defaultLocation) ?? guessDefaultLocation(category),
  }
}

function normalizeCandidate(
  raw: unknown,
  ingredients: IngredientSnapshot[]
): ResolveCandidate | null {
  const record = asRecord(raw)
  if (!record) return null
  const ingredientId = String(record.ingredientId ?? "").trim()
  const existing = ingredients.find(
    (ingredient) => ingredient.id === ingredientId
  )
  if (!existing) return null
  const reason = String(record.reason ?? "").trim()
  return {
    ingredientId: existing.id,
    name: existing.name,
    reason: reason || undefined,
  }
}

export function normalizeResolveResult(
  raw: unknown,
  item: ResolveInputItem,
  ingredients: IngredientSnapshot[],
  source: IngredientResolveResult["source"]
): IngredientResolveResult {
  const rawName = item.rawName.trim() || "未命名食材"
  const fallbackDraft = fallbackCreateDraft(rawName, item.unit)
  const record = asRecord(raw)
  if (!record) {
    return {
      rawName,
      action: "create",
      createDraft: fallbackDraft,
      source: "fallback",
    }
  }

  const action = readAction(record.action)
  if (action === "link") {
    const ingredientId = String(record.ingredientId ?? "").trim()
    const existing = ingredients.find(
      (ingredient) => ingredient.id === ingredientId
    )
    if (existing) {
      return {
        rawName,
        action: "link",
        ingredientId: existing.id,
        source,
      }
    }
    return {
      rawName,
      action: "create",
      createDraft: fallbackDraft,
      source: "fallback",
    }
  }

  if (action === "needs_confirm") {
    const candidates = Array.isArray(record.candidates)
      ? record.candidates
          .map((candidate) => normalizeCandidate(candidate, ingredients))
          .filter((candidate): candidate is ResolveCandidate =>
            Boolean(candidate)
          )
      : []
    if (candidates.length === 0) {
      return {
        rawName,
        action: "create",
        createDraft: normalizeCreateDraft(
          record.createDraft,
          rawName,
          item.unit
        ),
        source: "fallback",
      }
    }
    return {
      rawName,
      action: "needs_confirm",
      createDraft: normalizeCreateDraft(record.createDraft, rawName, item.unit),
      candidates,
      source,
    }
  }

  return {
    rawName,
    action: "create",
    createDraft: normalizeCreateDraft(record.createDraft, rawName, item.unit),
    source,
  }
}

export function mergeAiResults(
  input: ResolveIngredientsInput,
  ruled: IngredientResolveResult[],
  aiByName: Map<string, unknown>
): IngredientResolveResult[] {
  return ruled.map((row, index) => {
    if (row.source === "rule") return row
    const item = input.items[index] ?? { rawName: row.rawName }
    const ai = aiByName.get(normalizeIngredientName(item.rawName))
    if (ai == null) return row
    return normalizeResolveResult(ai, item, input.ingredients, "ai")
  })
}

export function tryParseResolveResultsJson(
  text: string,
  input: ResolveIngredientsInput,
  ruled: IngredientResolveResult[]
): IngredientResolveResult[] | null {
  try {
    const parsed = extractJsonObject(text)
    const record = asRecord(parsed)
    const list = Array.isArray(record?.results)
      ? record.results
      : Array.isArray(parsed)
        ? parsed
        : null
    if (!list) return null

    const aiByName = new Map<string, unknown>()
    for (const entry of list) {
      const row = asRecord(entry)
      const rawName = String(row?.rawName ?? "").trim()
      if (!rawName) continue
      aiByName.set(normalizeIngredientName(rawName), entry)
    }
    if (aiByName.size === 0) return null
    return mergeAiResults(input, ruled, aiByName)
  } catch {
    return null
  }
}

export function treatAmbiguityAsCreate(
  result: IngredientResolveResult
): IngredientResolveResult {
  if (result.action !== "needs_confirm") return result
  return {
    ...result,
    action: "create",
    createDraft: result.createDraft ?? fallbackCreateDraft(result.rawName),
  }
}
