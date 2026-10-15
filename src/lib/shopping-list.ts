import { categoryLabel, MARKET_UNITS } from "@/lib/labels"
import {
  shoppingPrimaryText,
  shoppingPurchaseUnit,
  shoppingSecondaryText,
} from "@/lib/shopping-from-plan"
import { CATEGORIES } from "@/lib/types"
import type { Category, Ingredient, ShoppingItem } from "@/lib/types"

export const UNSURE_GROUP_TITLE = "不确定家里还有没有"

export function checkInBoughtLabel(count: number): string {
  return `入库已买的 ${count} 样`
}

export type ShoppingLane = "buy" | "unsure" | "hidden"

/**
 * 采购清单只列要买的。
 * 不够、快没了、手加进主清单；够的不列；不确定沉到底部，除非已经点了要买。
 */
export function shoppingListSection(item: ShoppingItem): ShoppingLane {
  if (item.source === "manual" || item.source === "running_low") return "buy"
  if (item.shortage === "enough") return "hidden"
  if (item.shortage === "short") return "buy"
  if (item.presenceChoice === "have") return "hidden"
  if (item.presenceChoice === "buy") return "buy"
  if (item.shortage === "unsure") return "unsure"
  return "hidden"
}

export function shoppingItemCategory(
  item: ShoppingItem,
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "category">>
): Category {
  if (item.ingredientId) {
    const category = ingredientsById.get(item.ingredientId)?.category
    if (category) return category
  }
  if (
    item.stallHint === "meat" ||
    item.stallHint === "veg" ||
    item.stallHint === "dry"
  ) {
    return item.stallHint
  }
  return "other"
}

export type ShoppingAisleGroup = {
  category: Category
  label: string
  items: ShoppingItem[]
}

function compareShoppingRows(a: ShoppingItem, b: ShoppingItem): number {
  const bought = Number(a.status === "bought") - Number(b.status === "bought")
  if (bought !== 0) return bought
  return a.name.localeCompare(b.name, "zh-CN")
}

export function groupShoppingForAisle(
  items: ShoppingItem[],
  ingredients: ReadonlyArray<Pick<Ingredient, "id" | "category">>
): { buy: ShoppingAisleGroup[]; unsure: ShoppingItem[] } {
  const byId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const buckets = new Map<Category, ShoppingItem[]>()
  const unsure: ShoppingItem[] = []

  for (const item of items) {
    const lane = shoppingListSection(item)
    if (lane === "hidden") continue
    if (lane === "unsure") {
      unsure.push(item)
      continue
    }
    const category = shoppingItemCategory(item, byId)
    const list = buckets.get(category) ?? []
    list.push(item)
    buckets.set(category, list)
  }

  const buy = CATEGORIES.flatMap((category) => {
    const list = buckets.get(category)
    if (!list || list.length === 0) return []
    return [
      {
        category,
        label: categoryLabel[category],
        items: [...list].sort(compareShoppingRows),
      },
    ]
  })

  unsure.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  return { buy, unsure }
}

export function boughtInAisle(groups: ShoppingAisleGroup[]): ShoppingItem[] {
  return groups.flatMap((group) =>
    group.items.filter((item) => item.status === "bought")
  )
}

export function shoppingUnitOptions(item: ShoppingItem): string[] {
  return [shoppingPurchaseUnit(item), item.unit, ...MARKET_UNITS].filter(
    (unit, index, all) => Boolean(unit) && all.indexOf(unit) === index
  )
}

export function formatShoppingShareText(groups: ShoppingAisleGroup[]): string {
  const lines = ["做饭搭子 · 采购清单"]
  if (groups.length === 0) {
    lines.push("这次没有要买的。")
    return lines.join("\n")
  }
  for (const group of groups) {
    lines.push("")
    lines.push(`【${group.label}】`)
    for (const item of group.items) {
      const mark = item.status === "bought" ? "☑" : "☐"
      const extra = shoppingSecondaryText(item)
      lines.push(
        `${mark} ${item.name} ${shoppingPrimaryText(item)}${extra ? `（${extra}）` : ""}`
      )
    }
  }
  return lines.join("\n")
}
