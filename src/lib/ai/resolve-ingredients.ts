import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { extractJsonObject } from "@/lib/ai/parse-recipe"
import {
  classifyByRules,
  defaultLocationForCategory,
  guessCategory,
  placementForName,
} from "@/lib/ingredient-category"
import { guessIngredientKind, guessPurchaseUnit } from "@/lib/ingredient-kind"
import {
  confidentUnit,
  guessFamily,
  isBlockedAlias,
  isNonPurchasableName,
  linkableAliases,
  sameFamilyDifferentThing,
  samePantryIdentity,
  synonymGroupKey,
} from "@/lib/ingredient-identity"
import { MARKET_UNITS } from "@/lib/labels"
import { stallFromCategory } from "@/lib/shopping-from-plan"
import type { Category, IngredientKind, Location, StallHint } from "@/lib/types"
import { CATEGORIES, INGREDIENT_KINDS, LOCATIONS } from "@/lib/types"

export type IngredientSnapshot = {
  id: string
  name: string
  aliases: string[]
  category: Category
  defaultUnit: string
  stallHint: StallHint
  defaultShelfLifeDays: number | null
  purchaseUnit?: string
  kind?: IngredientKind
  family?: string
  buyable?: boolean
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
  purchaseUnit?: string
  kind?: IngredientKind
  family?: string
  buyable?: boolean
}

export type ResolveCandidate = {
  ingredientId: string
  name: string
  reason?: string
}

export type ResolveAction = "link" | "create" | "needs_confirm" | "skip"

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

export { guessCategory } from "@/lib/ingredient-category"

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
    purchaseUnit: ingredient.purchaseUnit,
    kind: ingredient.kind,
    family: ingredient.family,
    buyable: ingredient.buyable,
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
    return linkableAliases(ingredient).some(
      (alias) => normalizeIngredientName(alias) === needle
    )
  })
}

export function findSynonymIngredient(
  rawName: string,
  ingredients: IngredientSnapshot[]
): IngredientSnapshot | undefined {
  const key = synonymGroupKey(rawName)
  if (!key) return undefined
  return ingredients.find((ingredient) => {
    if (synonymGroupKey(ingredient.name) === key) return true
    return linkableAliases(ingredient).some(
      (alias) => synonymGroupKey(alias) === key
    )
  })
}

export function guessDefaultLocation(category: Category): Location {
  return defaultLocationForCategory(category)
}

export function guessDefaultUnit(
  rawName: string,
  category: Category,
  unitHint?: string
): string {
  const hint = unitHint?.trim() ?? ""
  if (hint && !FUZZY_UNITS.test(hint)) {
    const confident = confidentUnit(rawName, category)
    if (confident && hint === "把" && confident !== "把") return confident
    return hint
  }
  const confident = confidentUnit(rawName, category)
  if (confident) return confident
  if (category === "meat") return "斤"
  if (category === "seasoning") {
    if (/抽|油|酱|醋|料酒/.test(rawName)) return "瓶"
    return "勺"
  }
  if (category === "dry") return "袋"
  if (/奶|芝士|奶酪/.test(rawName)) return "盒"
  if (category === "other") return "个"
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
  const placement = placementForName(name, category)
  const kind = guessIngredientKind(name, category)
  const purchaseUnit = guessPurchaseUnit({
    name,
    category,
    unitHint,
    kind,
  })
  const guessedUnit = guessDefaultUnit(name, category, unitHint)
  const defaultUnit = kind === "staple" ? purchaseUnit : guessedUnit
  const family = guessFamily(name)
  return {
    name,
    aliases: [],
    category,
    defaultUnit,
    stallHint: stallFromCategory(category),
    defaultShelfLifeDays: placement.shelfLifeDays,
    defaultLocation: placement.location,
    purchaseUnit,
    kind,
    ...(family ? { family } : {}),
    ...(isNonPurchasableName(name) ? { buyable: false as const } : {}),
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
  if (isNonPurchasableName(rawName)) {
    return { rawName, action: "skip", source: "rule" }
  }
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

  const exact =
    findExactIngredient(rawName, ingredients) ??
    findSynonymIngredient(rawName, ingredients)
  if (exact && !sameFamilyDifferentThing(rawName, exact.name)) {
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
  if (
    value === "link" ||
    value === "create" ||
    value === "needs_confirm" ||
    value === "skip"
  ) {
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

function readKind(value: unknown): IngredientKind | null {
  if (typeof value !== "string") return null
  return (INGREDIENT_KINDS as readonly string[]).includes(value)
    ? (value as IngredientKind)
    : null
}

function readFamily(value: unknown, name: string): string | undefined {
  const text = String(value ?? "").trim()
  const guessed = guessFamily(name)
  if (!text || text.length > 8) return guessed
  return text
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
  const ruled = classifyByRules(name)
  const aiCategory = readCategory(record.category)
  const category = ruled ?? aiCategory ?? "other"
  const placement = placementForName(name, category)
  const trustAiDetails = ruled == null || ruled === aiCategory
  const family = readFamily(record.family, name)
  const aliases = readAliases(record.aliases).filter((alias) => {
    if (normalizeIngredientName(alias) === normalizeIngredientName(name)) {
      return false
    }
    return !isBlockedAlias({ name, family }, alias)
  })
  const kind = trustAiDetails
    ? (readKind(record.kind) ??
      fallback.kind ??
      guessIngredientKind(name, category))
    : guessIngredientKind(name, category)
  const hintedUnit = readUnit(record.defaultUnit, fallback.defaultUnit)
  const confident = confidentUnit(name, category)
  const defaultUnit =
    confident && hintedUnit === "把" && confident !== "把"
      ? confident
      : hintedUnit
  const hintedPurchase = readUnit(record.purchaseUnit, "")
  const purchaseUnit =
    (confident && hintedPurchase === "把" && confident !== "把"
      ? confident
      : hintedPurchase) ||
    fallback.purchaseUnit ||
    guessPurchaseUnit({
      name,
      category,
      defaultUnit,
      kind,
      unitHint,
    })
  return {
    name,
    aliases,
    category,
    defaultUnit: kind === "staple" ? purchaseUnit : defaultUnit,
    stallHint: trustAiDetails
      ? readStallHint(record.stallHint, category)
      : stallFromCategory(category),
    defaultShelfLifeDays: trustAiDetails
      ? readShelfDays(record.defaultShelfLifeDays, placement.shelfLifeDays)
      : placement.shelfLifeDays,
    defaultLocation: trustAiDetails
      ? (readLocation(record.defaultLocation) ?? placement.location)
      : placement.location,
    purchaseUnit,
    kind,
    ...(family ? { family } : {}),
    ...(isNonPurchasableName(name) ? { buyable: false as const } : {}),
  }
}

function linkIsSameThing(
  rawName: string,
  existing: IngredientSnapshot
): boolean {
  if (samePantryIdentity(rawName, existing.name)) return true
  if (
    linkableAliases(existing).some((alias) =>
      samePantryIdentity(rawName, alias)
    )
  ) {
    return true
  }
  if (sameFamilyDifferentThing(rawName, existing.name)) return false
  if (isBlockedAlias(existing, rawName)) return false
  return true
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
  if (action === "skip" || isNonPurchasableName(rawName)) {
    return { rawName, action: "skip", source: "rule" }
  }
  if (action === "link") {
    const ingredientId = String(record.ingredientId ?? "").trim()
    const existing = ingredients.find(
      (ingredient) => ingredient.id === ingredientId
    )
    if (existing && linkIsSameThing(rawName, existing)) {
      return {
        rawName,
        action: "link",
        ingredientId: existing.id,
        source,
      }
    }
    if (existing && !linkIsSameThing(rawName, existing)) {
      return {
        rawName,
        action: "create",
        createDraft: fallbackCreateDraft(rawName, item.unit),
        source: "fallback",
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
