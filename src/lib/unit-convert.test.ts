import { describe, expect, test } from "vitest"
import { matchCatalog } from "@/lib/ingredient-catalog"
import {
  convertToAccount,
  purchaseHint,
  toPurchaseQuantity,
} from "@/lib/unit-convert"

describe("单位换算", () => {
  test("斤和克收成记账克，勺收成毫升，瓶没有比例就不换", () => {
    const pork = matchCatalog("五花肉")
    const soy = matchCatalog("生抽")
    const tomato = matchCatalog("西红柿")
    if (!pork || !soy || !tomato) throw new Error("基准库缺了常用食材")

    expect(convertToAccount(pork, 1, "斤")).toEqual({
      ok: true,
      quantity: 500,
      unit: "g",
    })
    expect(convertToAccount(pork, 50, "克")).toEqual({
      ok: true,
      quantity: 50,
      unit: "g",
    })
    expect(convertToAccount(tomato, 2, "个")).toEqual({
      ok: true,
      quantity: 300,
      unit: "g",
    })
    expect(convertToAccount(soy, 1, "勺")).toEqual({
      ok: true,
      quantity: 15,
      unit: "ml",
    })
    expect(convertToAccount(soy, 1, "瓶")).toEqual({
      ok: false,
      quantity: 1,
      unit: "瓶",
    })
    expect(convertToAccount(pork, 1, "少许").ok).toBe(false)
    expect(convertToAccount(pork, 1, "个").ok).toBe(false)
  })

  test("采购单位能从记账单位折回去", () => {
    const pork = matchCatalog("五花肉")
    if (!pork) throw new Error("缺少五花肉")
    expect(toPurchaseQuantity(pork, 750)).toEqual({ quantity: 1.5, unit: "斤" })
    expect(purchaseHint(pork, 750)).toBe("约 1.5 斤")
    const egg = matchCatalog("鸡蛋")
    if (!egg) throw new Error("缺少鸡蛋")
    expect(toPurchaseQuantity(egg, 3)).toBeNull()
  })
})
