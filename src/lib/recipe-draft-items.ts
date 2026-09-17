import { uncookedPlanEntries } from "@/lib/cook-complete"
import type { LegacyPlanEntry } from "@/lib/cook-complete"
import { createId } from "@/lib/id"
import { recipeItemsFromResolved } from "@/lib/ingredient-resolve-apply"
import type { Ingredient, RecipeItem } from "@/lib/types"

export type EditableRecipeItem = {
  key: string
  rawName: string
  quantity: string
  unit: string
}

export type RecipeItemWrite = Pick<
  RecipeItem,
  "ingredientId" | "rawName" | "quantity" | "unit" | "matchStatus"
>

export type RecipeFieldsInput = {
  name: string
  servings: string | number
  minutes: string | number | null | undefined
  steps: string | string[]
}

export function createEditableRecipeItem(
  partial: Partial<EditableRecipeItem> = {}
): EditableRecipeItem {
  return {
    key: partial.key ?? createId("eri"),
    rawName: partial.rawName ?? "",
    quantity: partial.quantity ?? "",
    unit: partial.unit ?? "",
  }
}

export function editableItemsFromRecipeItems(
  items: Array<Pick<RecipeItem, "id" | "rawName" | "quantity" | "unit">>
): EditableRecipeItem[] {
  return items.map((item) =>
    createEditableRecipeItem({
      key: item.id,
      rawName: item.rawName,
      quantity: String(item.quantity),
      unit: item.unit,
    })
  )
}

export function editableItemsFromDraftItems(
  items: Array<{ rawName: string; quantity: number | string; unit: string }>
): EditableRecipeItem[] {
  return items.map((item) =>
    createEditableRecipeItem({
      rawName: item.rawName,
      quantity: String(item.quantity),
      unit: item.unit,
    })
  )
}

export function updateEditableRecipeItem(
  items: EditableRecipeItem[],
  key: string,
  patch: Partial<Pick<EditableRecipeItem, "rawName" | "quantity" | "unit">>
): EditableRecipeItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item))
}

export function addEditableRecipeItem(
  items: EditableRecipeItem[]
): EditableRecipeItem[] {
  return [...items, createEditableRecipeItem()]
}

export function removeEditableRecipeItem(
  items: EditableRecipeItem[],
  key: string
): EditableRecipeItem[] {
  return items.filter((item) => item.key !== key)
}

export function compactEditableRecipeItems(
  items: EditableRecipeItem[]
): EditableRecipeItem[] {
  return items.filter(
    (item) => item.rawName.trim() || item.quantity.trim() || item.unit.trim()
  )
}

export function toResolveInputItems(items: EditableRecipeItem[]): Array<{
  rawName: string
  unit?: string
}> {
  return compactEditableRecipeItems(items).map((item) => ({
    rawName: item.rawName.trim() || "未命名食材",
    unit: item.unit.trim() || undefined,
  }))
}

export function toResolvedRecipeItems(
  items: EditableRecipeItem[],
  byRawName: Map<string, Ingredient>
): RecipeItemWrite[] {
  return recipeItemsFromResolved(
    compactEditableRecipeItems(items).map((item) => ({
      rawName: item.rawName.trim() || "未命名食材",
      quantity: Number(item.quantity) || 0,
      unit: item.unit.trim() || "个",
    })),
    byRawName
  )
}

export function normalizeRecipeFields(input: RecipeFieldsInput): {
  name: string
  servings: number
  approxMinutes: number | null
  steps: string[]
} {
  const servings = Number(input.servings)
  const minutes =
    input.minutes == null || input.minutes === ""
      ? Number.NaN
      : Number(input.minutes)
  const stepLines = Array.isArray(input.steps)
    ? input.steps
    : input.steps.split(/\r?\n/)
  return {
    name: input.name.trim() || "未命名食谱",
    servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
    approxMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    steps: stepLines.map((step) => step.trim()).filter(Boolean),
  }
}

export function recipeItemReplacement(
  recipeId: string,
  existing: Array<Pick<RecipeItem, "id">>,
  nextItems: RecipeItemWrite[],
  createItemId: () => string = () => createId("ri")
): { removeIds: string[]; writes: RecipeItem[] } {
  return {
    removeIds: existing.map((item) => item.id),
    writes: nextItems.map((item) => ({
      id: createItemId(),
      recipeId,
      ...item,
    })),
  }
}

export function shouldRegenShoppingForRecipe(
  recipeId: string,
  planEntries: LegacyPlanEntry[]
): boolean {
  return uncookedPlanEntries(planEntries).some(
    (entry) => entry.recipeId === recipeId
  )
}
