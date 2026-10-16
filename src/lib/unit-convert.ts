import {
  conversionFactors,
  type CatalogEntry,
  type FactorSource,
} from "@/lib/ingredient-catalog"

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
  entry: FactorSource,
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

export function isApproximateUnit(source: FactorSource, unit: string): boolean {
  const text = unit.trim()
  const units = source.approximateUnits ?? []
  if (units.includes(text)) return true
  if (
    (text === "g" || text === "克") &&
    units.some((item) => item === "g" || item === "克")
  ) {
    return true
  }
  if (
    (text === "ml" || text === "毫升") &&
    units.some((item) => item === "ml" || item === "毫升")
  ) {
    return true
  }
  return false
}

/** 两个单位都相对记账单位有比例时才换。1 来源单位 = factor 个记账单位。 */
export function convertUnits(
  source: FactorSource,
  quantity: number,
  fromUnit: string,
  toUnit: string
): ConvertedQuantity & { approximate: boolean } {
  const from = fromUnit.trim()
  const to = toUnit.trim()
  if (!from || !to || FUZZY_UNITS.test(from) || !Number.isFinite(quantity)) {
    return { ok: false, quantity, unit: from || fromUnit, approximate: false }
  }
  if (from === to) {
    return {
      ok: true,
      quantity: roundQty(quantity),
      unit: to,
      approximate: false,
    }
  }
  const factors = conversionFactors(source)
  const fromFactor = factors[from]
  const toFactor = factors[to]
  if (fromFactor == null || toFactor == null || toFactor === 0) {
    return { ok: false, quantity, unit: from, approximate: false }
  }
  return {
    ok: true,
    quantity: roundQty((quantity * fromFactor) / toFactor),
    unit: to,
    approximate: isApproximateUnit(source, from),
  }
}

function gramsPerAccount(source: FactorSource): number | null {
  if (source.accountUnit === "g" || source.accountUnit === "克") return 1
  const factors = conversionFactors(source)
  const perGram = factors.g ?? factors["克"]
  if (perGram == null || perGram === 0) return null
  return 1 / perGram
}

/** 记账单位不同时，经克桥接。例如 0.5 只鸡 ≈ 750g 鸡块。 */
export function convertAcross(
  from: FactorSource,
  quantity: number,
  unit: string,
  to: FactorSource
): { quantity: number; unit: string; approximate: boolean } | null {
  const inAccount = convertUnits(from, quantity, unit, from.accountUnit)
  if (!inAccount.ok) return null
  if (from.accountUnit === to.accountUnit) {
    return {
      quantity: inAccount.quantity,
      unit: to.accountUnit,
      approximate: inAccount.approximate,
    }
  }
  const perGram = gramsPerAccount(from)
  const toPerGram = gramsPerAccount(to)
  if (perGram == null || toPerGram == null || toPerGram === 0) return null
  const grams = inAccount.quantity * perGram
  return {
    quantity: roundQty(grams / toPerGram),
    unit: to.accountUnit,
    approximate:
      inAccount.approximate ||
      isApproximateUnit(from, "g") ||
      isApproximateUnit(from, "克") ||
      isApproximateUnit(to, "g") ||
      isApproximateUnit(to, "克"),
  }
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
