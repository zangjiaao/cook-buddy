import { createId } from "@/lib/id"
import {
  guessIngredientKind,
  guessPurchaseUnit,
  normalizeIngredient,
} from "@/lib/ingredient-kind"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { stallFromCategory } from "@/lib/shopping-from-plan"
import type {
  Category,
  Ingredient,
  IngredientKind,
  StallHint,
} from "@/lib/types"

export function buildIngredient(input: {
  name: string
  category: Category
  defaultUnit: string
  stallHint?: StallHint
  aliases?: string[]
  defaultShelfLifeDays?: number | null
  purchaseUnit?: string
  kind?: IngredientKind
  family?: string
  buyable?: boolean
  catalogId?: string
  catalogGroup?: string
  quantityMode?: Ingredient["quantityMode"]
  shelfLifeByLocation?: Ingredient["shelfLifeByLocation"]
}): Ingredient {
  const kind = input.kind ?? guessIngredientKind(input.name, input.category)
  const purchaseUnit =
    input.purchaseUnit?.trim() ||
    guessPurchaseUnit({
      name: input.name,
      category: input.category,
      defaultUnit: input.defaultUnit,
      kind,
    })
  return normalizeIngredient({
    id: createId("ing"),
    name: input.name.trim(),
    aliases: input.aliases ?? [],
    category: input.category,
    defaultUnit: input.defaultUnit,
    stallHint: input.stallHint ?? stallFromCategory(input.category),
    defaultShelfLifeDays:
      input.defaultShelfLifeDays ?? CATEGORY_SHELF_LIFE_DAYS[input.category],
    purchaseUnit,
    kind,
    ...(input.family ? { family: input.family } : {}),
    ...(input.buyable === false ? { buyable: false as const } : {}),
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    ...(input.catalogGroup ? { catalogGroup: input.catalogGroup } : {}),
    ...(input.quantityMode ? { quantityMode: input.quantityMode } : {}),
    ...(input.shelfLifeByLocation
      ? { shelfLifeByLocation: input.shelfLifeByLocation }
      : {}),
  })
}

export function parseAliasText(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
}
