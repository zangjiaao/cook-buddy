import {
  normalizeIngredientName,
  withTypedAlias,
} from "@/lib/ai/match-ingredient"
import {
  fallbackCreateDraft,
  findExactIngredient,
  resolveIngredientsLocal,
  toIngredientSnapshot,
  treatAmbiguityAsCreate,
} from "@/lib/ai/resolve-ingredients"
import type {
  IngredientResolveResult,
  ResolveIngredientsInput,
  ResolveInputItem,
} from "@/lib/ai/resolve-ingredients"
import { ingredientsRepo } from "@/lib/db/repos"
import { correctMisfiledVegetable } from "@/lib/ingredient-category"
import { buildIngredient } from "@/lib/ingredient-record"
import type { Ingredient } from "@/lib/types"

function ingredientChanged(left: Ingredient, right: Ingredient): boolean {
  if (left.category !== right.category) return true
  if (left.stallHint !== right.stallHint) return true
  if (left.defaultShelfLifeDays !== right.defaultShelfLifeDays) return true
  if (left.kind !== right.kind) return true
  if (left.defaultUnit !== right.defaultUnit) return true
  if (left.purchaseUnit !== right.purchaseUnit) return true
  if (left.aliases.length !== right.aliases.length) return true
  return left.aliases.some((alias, index) => alias !== right.aliases[index])
}

async function storeLinked(
  current: Ingredient,
  rawName: string
): Promise<Ingredient> {
  const corrected = correctMisfiledVegetable(withTypedAlias(current, rawName))
  if (ingredientChanged(current, corrected)) {
    await ingredientsRepo.put(corrected)
    return corrected
  }
  return corrected
}

function aliasesForDraft(
  name: string,
  aliases: string[],
  rawName: string
): string[] {
  const extra = [rawName, ...aliases]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(
      (value) =>
        normalizeIngredientName(value) !== normalizeIngredientName(name)
    )
  return extra.filter((value, index, all) => all.indexOf(value) === index)
}

export async function persistIngredientResolution(
  result: IngredientResolveResult,
  ingredients: Ingredient[],
  options: { treatConfirmAsCreate?: boolean } = {}
): Promise<Ingredient | null> {
  const decided =
    options.treatConfirmAsCreate && result.action === "needs_confirm"
      ? treatAmbiguityAsCreate(result)
      : result

  if (decided.action === "skip") return null

  if (decided.action === "link" && decided.ingredientId) {
    const current = ingredients.find(
      (ingredient) => ingredient.id === decided.ingredientId
    )
    if (current) return storeLinked(current, decided.rawName)
  }

  const draft = decided.createDraft ?? fallbackCreateDraft(decided.rawName)
  const already =
    findExactIngredient(draft.name, ingredients) ??
    findExactIngredient(decided.rawName, ingredients)
  if (already) {
    const current =
      ingredients.find((ingredient) => ingredient.id === already.id) ?? already
    return storeLinked(current, decided.rawName)
  }
  const created = buildIngredient({
    name: draft.name,
    aliases: aliasesForDraft(draft.name, draft.aliases, decided.rawName),
    category: draft.category,
    defaultUnit: draft.defaultUnit,
    stallHint: draft.stallHint ?? undefined,
    defaultShelfLifeDays: draft.defaultShelfLifeDays,
    purchaseUnit: draft.purchaseUnit,
    kind: draft.kind,
    family: draft.family,
    buyable: draft.buyable,
    catalogId: draft.catalogId,
    catalogGroup: draft.catalogGroup,
    quantityMode: draft.quantityMode,
    shelfLifeByLocation: draft.shelfLifeByLocation,
  })
  await ingredientsRepo.put(created)
  return created
}

export async function persistIngredientResolutions(
  results: IngredientResolveResult[],
  starting: Ingredient[],
  options: { treatConfirmAsCreate?: boolean } = {}
): Promise<{ ingredients: Ingredient[]; byRawName: Map<string, Ingredient> }> {
  const ingredients = [...starting]
  const byRawName = new Map<string, Ingredient>()

  for (const result of results) {
    const key = normalizeIngredientName(result.rawName)
    const cached = byRawName.get(key)
    if (cached) continue
    if (result.action === "needs_confirm" && !options.treatConfirmAsCreate) {
      continue
    }
    const ingredient = await persistIngredientResolution(
      result,
      ingredients,
      options
    )
    if (!ingredient) continue
    const index = ingredients.findIndex((row) => row.id === ingredient.id)
    if (index >= 0) ingredients[index] = ingredient
    else ingredients.push(ingredient)
    byRawName.set(key, ingredient)
  }

  return { ingredients, byRawName }
}

export async function callResolveIngredients(
  input: ResolveIngredientsInput,
  serverCall?: (
    payload: ResolveIngredientsInput
  ) => Promise<IngredientResolveResult[]>
): Promise<IngredientResolveResult[]> {
  if (!serverCall) return resolveIngredientsLocal(input)
  try {
    return await serverCall(input)
  } catch {
    return resolveIngredientsLocal(input)
  }
}

export async function resolveAndPersistQuiet(
  items: ResolveInputItem[],
  starting: Ingredient[],
  serverCall?: (
    payload: ResolveIngredientsInput
  ) => Promise<IngredientResolveResult[]>,
  options: { treatConfirmAsCreate?: boolean } = {}
): Promise<{
  results: IngredientResolveResult[]
  pending: IngredientResolveResult[]
  ingredients: Ingredient[]
  byRawName: Map<string, Ingredient>
}> {
  const input = {
    items,
    ingredients: starting.map(toIngredientSnapshot),
  }
  const results = await callResolveIngredients(input, serverCall)
  const pending = options.treatConfirmAsCreate
    ? []
    : results.filter((result) => result.action === "needs_confirm")
  const persisted = await persistIngredientResolutions(
    results,
    starting,
    options
  )
  return {
    results,
    pending,
    ingredients: persisted.ingredients,
    byRawName: persisted.byRawName,
  }
}
