import { createServerFn } from "@tanstack/react-start"
import { suggestIngredientCleanupWithAi } from "@/lib/ai/ingredient-cleanup.server"
import { readDeepSeekRuntimeEnv } from "@/lib/ai/worker-env"
import type { Ingredient } from "@/lib/types"
import { CATEGORIES } from "@/lib/types"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return []
  const ingredients: Ingredient[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const id = String(record?.id ?? "").trim()
    const name = String(record?.name ?? "").trim()
    const category = record?.category
    if (!id || !name) continue
    if (
      typeof category !== "string" ||
      !(CATEGORIES as readonly string[]).includes(category)
    ) {
      continue
    }
    ingredients.push({
      id,
      name,
      aliases: Array.isArray(record?.aliases)
        ? record.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : [],
      category: category as Ingredient["category"],
      defaultUnit: String(record?.defaultUnit ?? "个").trim() || "个",
      stallHint:
        record?.stallHint === "meat" ||
        record?.stallHint === "veg" ||
        record?.stallHint === "dry"
          ? record.stallHint
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
      family: String(record?.family ?? "").trim() || undefined,
      buyable: record?.buyable === false ? false : undefined,
    })
  }
  return ingredients
}

export const suggestIngredientCleanup = createServerFn({ method: "POST" })
  .validator((data: { ingredients?: unknown }) => {
    return { ingredients: readIngredients(data.ingredients) }
  })
  .handler(async ({ data }) => {
    return suggestIngredientCleanupWithAi(data.ingredients, {
      env: readDeepSeekRuntimeEnv(),
    })
  })
