import { describe, expect, test } from "vitest"
import {
  deriveInventoryStatus,
  expiredInventoryIds,
  sortInventoryByExpiry,
} from "@/lib/inventory-status"

describe("deriveInventoryStatus", () => {
  test("无保质期视为新鲜", () => {
    expect(deriveInventoryStatus({ expiresAt: null }, "2026-09-16")).toBe(
      "fresh"
    )
  })

  test("过期日已过", () => {
    expect(
      deriveInventoryStatus({ expiresAt: "2026-09-15" }, "2026-09-16")
    ).toBe("expired")
  })

  test("三天内临期", () => {
    expect(
      deriveInventoryStatus({ expiresAt: "2026-09-19" }, "2026-09-16")
    ).toBe("soon")
  })

  test("更远为新鲜", () => {
    expect(
      deriveInventoryStatus({ expiresAt: "2026-09-30" }, "2026-09-16")
    ).toBe("fresh")
  })
})

describe("sortInventoryByExpiry", () => {
  test("先过期的在上面，没有日期的垫底", () => {
    const sorted = sortInventoryByExpiry([
      { expiresAt: null },
      { expiresAt: "2026-09-20" },
      { expiresAt: "2026-09-10" },
    ])
    expect(sorted.map((item) => item.expiresAt)).toEqual([
      "2026-09-10",
      "2026-09-20",
      null,
    ])
  })
})

describe("expiredInventoryIds", () => {
  test("只收已过期的 id", () => {
    expect(
      expiredInventoryIds(
        [
          { id: "a", expiresAt: "2026-09-15" },
          { id: "b", expiresAt: "2026-09-16" },
          { id: "c", expiresAt: null },
        ],
        "2026-09-16"
      )
    ).toEqual(["a"])
  })
})
