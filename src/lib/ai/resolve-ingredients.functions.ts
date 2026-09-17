import { createServerFn } from "@tanstack/react-start"
import { resolveIngredientsWithAi } from "@/lib/ai/resolve-ingredients.server"
import type {
  IngredientSnapshot,
  ResolveInputItem,
} from "@/lib/ai/resolve-ingredients"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readItems(value: unknown): ResolveInputItem[] {
  if (!Array.isArray(value)) throw new Error("items required")
  return value.map((entry) => {
    const record = asRecord(entry)
    const rawName = String(record?.rawName ?? "").trim()
    if (!rawName) throw new Error("rawName required")
    const unit = String(record?.unit ?? "").trim()
    const ingredientId = record?.ingredientId
    return {
      rawName,
      unit: unit || undefined,
      ingredientId:
        typeof ingredientId === "string" && ingredientId.trim()
          ? ingredientId.trim()
          : ingredientId === null
            ? null
            : undefined,
    }
  })
}

function readIngredients(value: unknown): IngredientSnapshot[] {
  if (!Array.isArray(value)) throw new Error("ingredients required")
  return value.map((entry) => {
    const record = asRecord(entry)
    const id = String(record?.id ?? "").trim()
    const name = String(record?.name ?? "").trim()
    if (!id || !name) throw new Error("ingredient id/name required")
    const category = record?.category
    if (
      category !== "meat" &&
      category !== "veg" &&
      category !== "dry" &&
      category !== "seasoning"
    ) {
      throw new Error("ingredient category required")
    }
    const stallHint = record?.stallHint
    return {
      id,
      name,
      aliases: Array.isArray(record?.aliases)
        ? record.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : [],
      category,
      defaultUnit: String(record?.defaultUnit ?? "个").trim() || "个",
      stallHint:
        stallHint === "meat" || stallHint === "veg" || stallHint === "dry"
          ? stallHint
          : null,
      defaultShelfLifeDays:
        record?.defaultShelfLifeDays == null
          ? null
          : Number(record.defaultShelfLifeDays),
      purchaseUnit: String(record?.purchaseUnit ?? "").trim() || undefined,
      kind:
        record?.kind === "staple" || record?.kind === "fresh"
          ? record.kind
          : undefined,
    }
  })
}

export const resolveIngredients = createServerFn({ method: "POST" })
  .validator((data: { items: unknown; ingredients: unknown }) => {
    return {
      items: readItems(data.items),
      ingredients: readIngredients(data.ingredients),
    }
  })
  .handler(async ({ data }) => {
    return resolveIngredientsWithAi(data)
  })
