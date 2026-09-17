import { describe, expect, test } from "vitest"
import { stallText } from "@/lib/labels"

describe("stallText", () => {
  test("有摊位提示时用档口名", () => {
    expect(stallText("meat")).toBe("肉档")
    expect(stallText("veg")).toBe("菜摊")
    expect(stallText("dry")).toBe("干货")
  })

  test("没有摊位分类时归到其他，不是未分摊", () => {
    expect(stallText(null)).toBe("其他")
  })
})
