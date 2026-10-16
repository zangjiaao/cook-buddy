import { conversionFactors, type CatalogEntry } from "@/lib/ingredient-catalog"

const FUZZY_UNITS = /^(少许|适量|若干)$/

export function roundQty(value: number): number {
  return Number(value.toFixed(2))
}

export type ConvertedQuantity = {
  ok: boolean
  quantity: number
  unit: string
}

/** 换得了就把数量收成记账单位。换不了就原样返回，调用方自己标注。 */
export function convertToAccount(
  entry: Pick<CatalogEntry, "accountUnit" | "conversions">,
  quantity: number,
  unit: string
): ConvertedQuantity {
  const text = unit.trim()
  if (!text || FUZZY_UNITS.test(text) || !Number.isFinite(quantity)) {
    return { ok: false, quantity, unit: text || unit }
  }
  const factor = conversionFactors(entry)[text]
  if (factor == null) return { ok: false, quantity, unit: text }
  return {
    ok: true,
    quantity: roundQty(quantity * factor),
    unit: entry.accountUnit,
  }
}

export function isFuzzyUnit(unit: string): boolean {
  return FUZZY_UNITS.test(unit.trim())
}

/** 记账数量换成采购单位。采购单位没有可靠比例时返回 null。 */
export function toPurchaseQuantity(
  entry: Pick<CatalogEntry, "accountUnit" | "purchaseUnit" | "conversions">,
  accountQty: number
): { quantity: number; unit: string } | null {
  if (!Number.isFinite(accountQty)) return null
  if (entry.purchaseUnit === entry.accountUnit) return null
  const factor = conversionFactors(entry)[entry.purchaseUnit]
  if (factor == null || factor === 0) return null
  return { quantity: roundQty(accountQty / factor), unit: entry.purchaseUnit }
}

export function purchaseHint(
  entry: Pick<CatalogEntry, "accountUnit" | "purchaseUnit" | "conversions">,
  accountQty: number
): string {
  const purchase = toPurchaseQuantity(entry, accountQty)
  if (!purchase) return ""
  return `约 ${purchase.quantity} ${purchase.unit}`
}
