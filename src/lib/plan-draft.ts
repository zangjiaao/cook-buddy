import { extractJsonObject } from "@/lib/ai/parse-recipe"
import { isPlanEntryCooked } from "@/lib/cook-complete"
import {
  addDays,
  enumerateDates,
  formatISODate,
  isISODate,
  parseISODate,
  prettyDate,
} from "@/lib/dates"
import { deriveInventoryStatus } from "@/lib/inventory-status"
import { MAX_PLAN_HORIZON_DAYS, resolvePlanHorizon } from "@/lib/plan-horizon"
import { recipeTagLabel, sanitizeRecipeTags } from "@/lib/recipe-organize"
import type { RecipeTag } from "@/lib/recipe-organize"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"

export const PLAN_DRAFT_DAY_PRESETS = [3, 5, 7] as const
export type PlanDraftDayPreset = (typeof PLAN_DRAFT_DAY_PRESETS)[number]

export const DEFAULT_DISHES_PER_DAY = 2
export const MAX_DISHES_PER_DAY = 4

export const PLAN_DRAFT_FILL_STRATEGIES = ["empty", "replace"] as const
export type PlanDraftFillStrategy = (typeof PLAN_DRAFT_FILL_STRATEGIES)[number]

export const PLAN_DRAFT_SOURCES = ["ai", "heuristic"] as const
export type PlanDraftSource = (typeof PLAN_DRAFT_SOURCES)[number]

export const PLAN_DRAFT_REASONS = ["soon", "favorite", "tag"] as const
export type PlanDraftReason = (typeof PLAN_DRAFT_REASONS)[number]

export type PlanDraftRange =
  { type: "horizon" } | { type: "days"; days: number }

export type PlanDraftRecipe = {
  id: string
  name: string
  servings: number
  favorited: boolean
  tags: RecipeTag[]
  ingredientIds: string[]
}

export type PlanDraftInput = {
  days: string[]
  recipes: PlanDraftRecipe[]
  soonIngredientIds: string[]
  occupiedDates: string[]
  fillStrategy: PlanDraftFillStrategy
  dishesPerDay?: number
}

export type PlanDraftDish = {
  recipeId: string
  servings: number
  reasons: PlanDraftReason[]
}

export type PlanDraftDay = {
  date: string
  dishes: PlanDraftDish[]
  skippedReason?: "occupied"
}

export type PlanDraft = {
  days: PlanDraftDay[]
  source: PlanDraftSource
  fillStrategy: PlanDraftFillStrategy
  notes: string[]
}

export type PlanDraftAdd = {
  date: string
  recipeId: string
  servings: number
  sortOrder: number
}

export type PlanDraftWrite = {
  removeIds: string[]
  adds: PlanDraftAdd[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)]
}

function clampDishesPerDay(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_DISHES_PER_DAY
  return Math.min(MAX_DISHES_PER_DAY, Math.max(1, Math.round(number)))
}

function positiveServings(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return Math.max(1, fallback)
  return Math.round(number)
}

export function planDraftSourceLabel(source: PlanDraftSource): string {
  return source === "ai" ? "AI 草稿" : "规则草稿"
}

export function planDraftReasonLabel(reason: PlanDraftReason): string {
  if (reason === "soon") return "含临期"
  if (reason === "favorite") return "常做"
  return "荤素搭配"
}

export function planDraftDishHint(
  dish: PlanDraftDish,
  recipe: PlanDraftRecipe | undefined
): string {
  const parts = dish.reasons.map(planDraftReasonLabel)
  if (recipe) {
    const tags = recipe.tags.map((tag) => recipeTagLabel[tag])
    for (const tag of tags) {
      if (!parts.includes(tag)) parts.push(tag)
    }
  }
  return parts.join(" · ")
}

export function occupiedDatesFromEntries(
  entries: Iterable<Pick<PlanEntry, "date">>,
  days: readonly string[]
): string[] {
  const daySet = new Set(days)
  const occupied = new Set<string>()
  for (const entry of entries) {
    if (daySet.has(entry.date)) occupied.add(entry.date)
  }
  return [...occupied].sort()
}

export function soonIngredientIdsFromInventory(
  inventory: Iterable<Pick<InventoryItem, "ingredientId" | "expiresAt">>,
  today?: string
): string[] {
  const ids = new Set<string>()
  for (const item of inventory) {
    if (deriveInventoryStatus(item, today) === "soon") {
      ids.add(item.ingredientId)
    }
  }
  return [...ids]
}

export function toPlanDraftRecipes(
  recipes: Iterable<Recipe>,
  recipeItems: Iterable<RecipeItem>
): PlanDraftRecipe[] {
  const itemsByRecipe = new Map<string, string[]>()
  for (const item of recipeItems) {
    if (!item.ingredientId) continue
    const list = itemsByRecipe.get(item.recipeId) ?? []
    list.push(item.ingredientId)
    itemsByRecipe.set(item.recipeId, list)
  }

  return [...recipes].map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    servings: Math.max(1, recipe.servings || 2),
    favorited: Boolean(recipe.favorited),
    tags: sanitizeRecipeTags(recipe.tags),
    ingredientIds: uniqueStrings(itemsByRecipe.get(recipe.id) ?? []),
  }))
}

export function resolvePlanDraftDays(input: {
  today: string
  range: PlanDraftRange
  horizonEnd?: string | null
  maxDays?: number
}): string[] {
  const maxDays = input.maxDays ?? MAX_PLAN_HORIZON_DAYS
  if (input.range.type === "horizon") {
    return resolvePlanHorizon({
      today: input.today,
      preferredEnd: input.horizonEnd,
      maxDays,
    }).days
  }
  const count = Math.min(Math.max(Math.round(input.range.days), 1), maxDays)
  const end = formatISODate(addDays(parseISODate(input.today), count - 1))
  return enumerateDates(input.today, end)
}

export function buildPlanDraftInput(input: {
  today: string
  range: PlanDraftRange
  horizonEnd?: string | null
  recipes: Recipe[]
  recipeItems: RecipeItem[]
  inventory: InventoryItem[]
  entries: PlanEntry[]
  fillStrategy?: PlanDraftFillStrategy
  dishesPerDay?: number
}): PlanDraftInput {
  const days = resolvePlanDraftDays(input)
  return {
    days,
    recipes: toPlanDraftRecipes(input.recipes, input.recipeItems),
    soonIngredientIds: soonIngredientIdsFromInventory(
      input.inventory,
      input.today
    ),
    occupiedDates: occupiedDatesFromEntries(input.entries, days),
    fillStrategy: input.fillStrategy ?? "empty",
    dishesPerDay: clampDishesPerDay(input.dishesPerDay),
  }
}

function recipeByIdMap(
  recipes: PlanDraftRecipe[]
): Map<string, PlanDraftRecipe> {
  return new Map(recipes.map((recipe) => [recipe.id, recipe]))
}

export function dishReasonsFor(
  recipe: PlanDraftRecipe,
  soonIngredientIds: ReadonlySet<string>
): PlanDraftReason[] {
  const reasons: PlanDraftReason[] = []
  if (recipe.ingredientIds.some((id) => soonIngredientIds.has(id))) {
    reasons.push("soon")
  }
  if (recipe.favorited) reasons.push("favorite")
  if (recipe.tags.length > 0) reasons.push("tag")
  return reasons
}

function scoreRecipe(
  recipe: PlanDraftRecipe,
  ctx: {
    soonIngredientIds: ReadonlySet<string>
    usedRecipeIds: ReadonlySet<string>
    usedTagsToday: ReadonlySet<RecipeTag>
    dayIndex: number
    dayCount: number
  }
): number {
  const soonHits = recipe.ingredientIds.filter((id) =>
    ctx.soonIngredientIds.has(id)
  ).length
  const unusedTags = recipe.tags.filter(
    (tag) => !ctx.usedTagsToday.has(tag)
  ).length
  const earlyBonus = soonHits > 0 ? (ctx.dayCount - ctx.dayIndex) * 12 : 0
  const repeatPenalty = ctx.usedRecipeIds.has(recipe.id) ? 35 : 0
  return (
    soonHits * 100 +
    earlyBonus +
    (recipe.favorited ? 40 : 0) +
    unusedTags * 18 +
    recipe.tags.length * 2 -
    repeatPenalty
  )
}

function pickDishesForDay(
  recipes: PlanDraftRecipe[],
  ctx: {
    soonIngredientIds: ReadonlySet<string>
    usedRecipeIds: Set<string>
    dayIndex: number
    dayCount: number
    dishesPerDay: number
  }
): PlanDraftDish[] {
  if (recipes.length === 0) return []
  const usedToday = new Set<string>()
  const usedTagsToday = new Set<RecipeTag>()
  const target = Math.min(ctx.dishesPerDay, recipes.length, MAX_DISHES_PER_DAY)
  const dishes: PlanDraftDish[] = []

  for (let slot = 0; slot < target; slot += 1) {
    let best: PlanDraftRecipe | null = null
    let bestScore = -Infinity
    for (const recipe of recipes) {
      if (usedToday.has(recipe.id)) continue
      const score = scoreRecipe(recipe, {
        soonIngredientIds: ctx.soonIngredientIds,
        usedRecipeIds: ctx.usedRecipeIds,
        usedTagsToday,
        dayIndex: ctx.dayIndex,
        dayCount: ctx.dayCount,
      })
      if (
        !best ||
        score > bestScore ||
        (score === bestScore && recipe.name.localeCompare(best.name, "zh") < 0)
      ) {
        best = recipe
        bestScore = score
      }
    }
    if (!best) break
    dishes.push({
      recipeId: best.id,
      servings: best.servings,
      reasons: dishReasonsFor(best, ctx.soonIngredientIds),
    })
    usedToday.add(best.id)
    ctx.usedRecipeIds.add(best.id)
    for (const tag of best.tags) usedTagsToday.add(tag)
  }

  return dishes
}

function draftNotes(input: PlanDraftInput, days: PlanDraftDay[]): string[] {
  const notes: string[] = []
  const proposed = days.filter((day) => day.dishes.length > 0).length
  const skipped = days.filter((day) => day.skippedReason === "occupied").length
  if (input.recipes.length === 0) {
    notes.push("还没有食谱，先去加几道常做的。")
    return notes
  }
  if (proposed === 0 && skipped === days.length && days.length > 0) {
    notes.push("这几天都排过了。默认只填空天，已有的日子先不动。")
  } else if (skipped > 0) {
    notes.push("已有菜的日子先不动，只往空天塞。")
  }
  if (input.soonIngredientIds.length > 0) {
    notes.push("能消化临期库存的菜会尽量排前面。")
  }
  return notes
}

export function heuristicPlanDraft(input: PlanDraftInput): PlanDraft {
  const occupied = new Set(input.occupiedDates)
  const soonIngredientIds = new Set(input.soonIngredientIds)
  const dishesPerDay = clampDishesPerDay(input.dishesPerDay)
  const usedRecipeIds = new Set<string>()
  const days = input.days.map((date, dayIndex) => {
    if (input.fillStrategy === "empty" && occupied.has(date)) {
      return {
        date,
        dishes: [] as PlanDraftDish[],
        skippedReason: "occupied" as const,
      }
    }
    return {
      date,
      dishes: pickDishesForDay(input.recipes, {
        soonIngredientIds,
        usedRecipeIds,
        dayIndex,
        dayCount: input.days.length,
        dishesPerDay,
      }),
    }
  })

  return {
    days,
    source: "heuristic",
    fillStrategy: input.fillStrategy === "replace" ? "replace" : "empty",
    notes: draftNotes(input, days),
  }
}

function sanitizeDishes(
  rawDishes: unknown,
  catalog: Map<string, PlanDraftRecipe>,
  soonIngredientIds: ReadonlySet<string>
): PlanDraftDish[] {
  const seen = new Set<string>()
  const dishes: PlanDraftDish[] = []
  const rows = Array.isArray(rawDishes) ? rawDishes : []
  for (const row of rows) {
    if (dishes.length >= MAX_DISHES_PER_DAY) break
    const recipeId =
      typeof row === "string"
        ? row
        : String(asRecord(row)?.recipeId ?? asRecord(row)?.id ?? "").trim()
    if (!recipeId || seen.has(recipeId)) continue
    const recipe = catalog.get(recipeId)
    if (!recipe) continue
    const record = asRecord(row)
    seen.add(recipeId)
    dishes.push({
      recipeId,
      servings: positiveServings(record?.servings, recipe.servings),
      reasons: dishReasonsFor(recipe, soonIngredientIds),
    })
  }
  return dishes
}

export function sanitizePlanDraftDays(
  rawDays: unknown,
  input: PlanDraftInput
): PlanDraftDay[] | null {
  if (!Array.isArray(rawDays)) return null
  const catalog = recipeByIdMap(input.recipes)
  const allowed = new Set(input.days)
  const occupied = new Set(input.occupiedDates)
  const soon = new Set(input.soonIngredientIds)
  const byDate = new Map<string, PlanDraftDay>()

  for (const row of rawDays) {
    const record = asRecord(row)
    const date = String(record?.date ?? "").trim()
    if (!isISODate(date) || !allowed.has(date)) continue
    const dishes = sanitizeDishes(
      Array.isArray(record?.dishes) ? record.dishes : record?.recipeIds,
      catalog,
      soon
    )
    byDate.set(date, { date, dishes })
  }

  if (byDate.size === 0) return null

  return input.days.map((date) => {
    if (input.fillStrategy === "empty" && occupied.has(date)) {
      return { date, dishes: [], skippedReason: "occupied" }
    }
    const proposed = byDate.get(date)
    if (proposed && proposed.dishes.length > 0) {
      return { date, dishes: proposed.dishes }
    }
    return { date, dishes: proposed?.dishes ?? [] }
  })
}

export function mergeAiPlanDraft(
  aiDays: PlanDraftDay[],
  input: PlanDraftInput,
  fallback = heuristicPlanDraft(input)
): PlanDraft {
  const aiByDate = new Map(aiDays.map((day) => [day.date, day]))
  const days = fallback.days.map((day) => {
    const ai = aiByDate.get(day.date)
    if (ai && ai.dishes.length > 0) {
      return { date: day.date, dishes: ai.dishes }
    }
    return day
  })
  const usedAi = days.some(
    (day, index) => day.dishes !== fallback.days[index].dishes
  )

  return {
    days,
    source: usedAi ? "ai" : "heuristic",
    fillStrategy: input.fillStrategy === "replace" ? "replace" : "empty",
    notes: usedAi
      ? draftNotes(input, days).filter((note) => !note.includes("还没有食谱"))
      : fallback.notes,
  }
}

export function tryParsePlanDraftJson(
  text: string,
  input: PlanDraftInput
): PlanDraftDay[] | null {
  try {
    const record = asRecord(extractJsonObject(text))
    if (!record) return null
    return sanitizePlanDraftDays(record.days, input)
  } catch {
    return null
  }
}

export function normalizePlanDraftInput(raw: unknown): PlanDraftInput | null {
  const record = asRecord(raw)
  if (!record) return null
  const days = uniqueStrings(
    (Array.isArray(record.days) ? record.days : [])
      .map((value) => String(value).trim())
      .filter(isISODate)
  ).sort()
  if (days.length === 0) return null

  const recipes: PlanDraftRecipe[] = []
  const seenRecipe = new Set<string>()
  for (const row of Array.isArray(record.recipes) ? record.recipes : []) {
    const item = asRecord(row)
    const id = String(item?.id ?? "").trim()
    const name = String(item?.name ?? "").trim()
    if (!id || !name || seenRecipe.has(id)) continue
    seenRecipe.add(id)
    recipes.push({
      id,
      name,
      servings: positiveServings(item?.servings, 2),
      favorited: Boolean(item?.favorited),
      tags: sanitizeRecipeTags(item?.tags),
      ingredientIds: uniqueStrings(
        (Array.isArray(item?.ingredientIds) ? item.ingredientIds : [])
          .map((value) => String(value).trim())
          .filter(Boolean)
      ),
    })
  }

  const soonIngredientIds = uniqueStrings(
    (Array.isArray(record.soonIngredientIds) ? record.soonIngredientIds : [])
      .map((value) => String(value).trim())
      .filter(Boolean)
  )
  const occupiedDates = uniqueStrings(
    (Array.isArray(record.occupiedDates) ? record.occupiedDates : [])
      .map((value) => String(value).trim())
      .filter((value) => isISODate(value) && days.includes(value))
  ).sort()

  return {
    days,
    recipes,
    soonIngredientIds,
    occupiedDates,
    fillStrategy: record.fillStrategy === "replace" ? "replace" : "empty",
    dishesPerDay: clampDishesPerDay(record.dishesPerDay),
  }
}

export function planDraftHasProposals(draft: PlanDraft): boolean {
  return draft.days.some((day) => day.dishes.length > 0)
}

export function replaceDatesInDraft(
  draft: PlanDraft,
  occupiedDates: Iterable<string>
): string[] {
  const occupied = new Set(occupiedDates)
  return draft.days
    .filter((day) => day.dishes.length > 0 && occupied.has(day.date))
    .map((day) => day.date)
}

export function fillDraftDay(
  draft: PlanDraft,
  date: string,
  input: PlanDraftInput
): PlanDraft {
  const filled = heuristicPlanDraft({
    ...input,
    days: [date],
    occupiedDates: [],
    fillStrategy: "replace",
  }).days[0]
  return {
    ...draft,
    days: draft.days.map((day) =>
      day.date === date ? { date, dishes: filled.dishes } : day
    ),
  }
}

export function removeDraftDish(
  draft: PlanDraft,
  date: string,
  recipeId: string
): PlanDraft {
  return {
    ...draft,
    days: draft.days.map((day) =>
      day.date === date
        ? {
            date: day.date,
            dishes: day.dishes.filter((dish) => dish.recipeId !== recipeId),
          }
        : day
    ),
  }
}

export function addDraftDish(
  draft: PlanDraft,
  date: string,
  recipe: PlanDraftRecipe,
  soonIngredientIds: Iterable<string> = []
): PlanDraft {
  const soon = new Set(soonIngredientIds)
  return {
    ...draft,
    days: draft.days.map((day) => {
      if (day.date !== date) return day
      if (day.dishes.some((dish) => dish.recipeId === recipe.id)) return day
      if (day.dishes.length >= MAX_DISHES_PER_DAY) return day
      return {
        date: day.date,
        dishes: [
          ...day.dishes,
          {
            recipeId: recipe.id,
            servings: recipe.servings,
            reasons: dishReasonsFor(recipe, soon),
          },
        ],
      }
    }),
  }
}

export function swapDraftDish(
  draft: PlanDraft,
  date: string,
  fromRecipeId: string,
  toRecipe: PlanDraftRecipe,
  soonIngredientIds: Iterable<string> = []
): PlanDraft {
  const soon = new Set(soonIngredientIds)
  return {
    ...draft,
    days: draft.days.map((day) => {
      if (day.date !== date) return day
      if (day.dishes.some((dish) => dish.recipeId === toRecipe.id)) {
        return {
          date: day.date,
          dishes: day.dishes.filter((dish) => dish.recipeId !== fromRecipeId),
        }
      }
      return {
        date: day.date,
        dishes: day.dishes.map((dish) =>
          dish.recipeId === fromRecipeId
            ? {
                recipeId: toRecipe.id,
                servings: toRecipe.servings,
                reasons: dishReasonsFor(toRecipe, soon),
              }
            : dish
        ),
      }
    }),
  }
}

export function setDraftDishServings(
  draft: PlanDraft,
  date: string,
  recipeId: string,
  servings: number
): PlanDraft {
  const next = positiveServings(servings, 1)
  return {
    ...draft,
    days: draft.days.map((day) =>
      day.date === date
        ? {
            ...day,
            dishes: day.dishes.map((dish) =>
              dish.recipeId === recipeId ? { ...dish, servings: next } : dish
            ),
          }
        : day
    ),
  }
}

export function buildPlanDraftWrites(input: {
  existing: PlanEntry[]
  draft: PlanDraft
  occupiedDates?: Iterable<string>
  replaceDates?: Iterable<string>
}): PlanDraftWrite {
  const occupied = new Set(
    input.occupiedDates ??
      occupiedDatesFromEntries(
        input.existing,
        input.draft.days.map((day) => day.date)
      )
  )
  const replace = new Set(input.replaceDates ?? [])
  if (input.draft.fillStrategy === "replace") {
    for (const day of input.draft.days) {
      if (day.dishes.length > 0) replace.add(day.date)
    }
  }

  const removeIds: string[] = []
  const adds: PlanDraftAdd[] = []

  for (const day of input.draft.days) {
    if (day.dishes.length === 0) continue
    const existingOnDay = input.existing.filter(
      (entry) => entry.date === day.date
    )
    const hasExisting = existingOnDay.length > 0
    if (hasExisting && !replace.has(day.date) && occupied.has(day.date)) {
      continue
    }

    const cooked = existingOnDay.filter((entry) => isPlanEntryCooked(entry))
    if (hasExisting && replace.has(day.date)) {
      for (const entry of existingOnDay) {
        if (!isPlanEntryCooked(entry)) removeIds.push(entry.id)
      }
    }

    day.dishes.forEach((dish, index) => {
      adds.push({
        date: day.date,
        recipeId: dish.recipeId,
        servings: positiveServings(dish.servings, 2),
        sortOrder: cooked.length + index,
      })
    })
  }

  return { removeIds, adds }
}

export function planDraftWriteNeedsConfirm(
  draft: PlanDraft,
  occupiedDates: Iterable<string>
): boolean {
  return replaceDatesInDraft(draft, occupiedDates).length > 0
}

export function replaceConfirmCopy(dates: string[], today: string): string {
  const labels = dates.map((date) => prettyDate(date, today)).join("、")
  return `${labels}已经有菜。写入会换掉还没做的，做过的不动。`
}

export const PLAN_DRAFT_FILL_HINT =
  "默认只往空天塞菜，已经排过的日子先不动。要换掉还没做的，需你点头。"
