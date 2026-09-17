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
import { buildIngredient } from "@/lib/ingredient-record"
import type { Ingredient } from "@/lib/types"

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
): Promise<Ingredient> {
  const decided =
    options.treatConfirmAsCreate && result.action === "needs_confirm"
      ? treatAmbiguityAsCreate(result)
      : result

  if (decided.action === "link" && decided.ingredientId) {
    const current = ingredients.find(
      (ingredient) => ingredient.id === decided.ingredientId
    )
    if (current) {
      const aliased = withTypedAlias(current, decided.rawName)
      if (aliased.aliases.length !== current.aliases.length) {
        await ingredientsRepo.put(aliased)
        return aliased
      }
      return current
    }
  }

  const draft = decided.createDraft ?? fallbackCreateDraft(decided.rawName)
  const already =
    findExactIngredient(draft.name, ingredients) ??
    findExactIngredient(decided.rawName, ingredients)
  if (already) {
    const current =
      ingredients.find((ingredient) => ingredient.id === already.id) ?? already
    const aliased = withTypedAlias(current, decided.rawName)
    if (aliased.aliases.length !== current.aliases.length) {
      await ingredientsRepo.put(aliased)
      return aliased
    }
    return current
  }
  const created = buildIngredient({
    name: draft.name,
    aliases: aliasesForDraft(draft.name, draft.aliases, decided.rawName),
    category: draft.category,
    defaultUnit: draft.defaultUnit,
    stallHint: draft.stallHint ?? undefined,
    defaultShelfLifeDays: draft.defaultShelfLifeDays,
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
