import { createId } from "@/lib/id"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { stallFromCategory } from "@/lib/shopping-from-plan"
import type { Category, Ingredient, StallHint } from "@/lib/types"

export function buildIngredient(input: {
  name: string
  category: Category
  defaultUnit: string
  stallHint?: StallHint
  aliases?: string[]
  defaultShelfLifeDays?: number | null
}): Ingredient {
  return {
    id: createId("ing"),
    name: input.name.trim(),
    aliases: input.aliases ?? [],
    category: input.category,
    defaultUnit: input.defaultUnit,
    stallHint: input.stallHint ?? stallFromCategory(input.category),
    defaultShelfLifeDays:
      input.defaultShelfLifeDays ?? CATEGORY_SHELF_LIFE_DAYS[input.category],
  }
}

export function parseAliasText(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
}
