import { describe, expect, test } from "vitest"
import {
  addDays,
  daysUntil,
  enumerateDates,
  formatISODate,
  formatMonthDay,
  isISODate,
  parseISODate,
  prettyDate,
} from "@/lib/dates"

describe("isISODate", () => {
  test("只认真实的年月日", () => {
    expect(isISODate("2026-09-21")).toBe(true)
    expect(isISODate("2026-02-31")).toBe(false)
    expect(isISODate("09-21")).toBe(false)
    expect(isISODate("not-a-date")).toBe(false)
  })
})

describe("formatMonthDay", () => {
  test("不补零，写成 M月D日", () => {
    expect(formatMonthDay("2026-09-21")).toBe("9月21日")
    expect(formatMonthDay("2026-10-02")).toBe("10月2日")
  })
})

describe("prettyDate", () => {
  const today = "2026-09-17"

  test("近三天用相对说法", () => {
    expect(prettyDate("2026-09-17", today)).toBe("今天")
    expect(prettyDate("2026-09-18", today)).toBe("明天")
    expect(prettyDate("2026-09-19", today)).toBe("后天")
  })

  test("更远的日子写成具体日期", () => {
    expect(prettyDate("2026-09-21", today)).toBe("9月21日")
    expect(prettyDate("2026-09-22", today)).toBe("9月22日")
    expect(prettyDate("2026-10-01", today)).toBe("10月1日")
  })

  test("过去的日子也用具体日期，不当今天", () => {
    expect(prettyDate("2026-09-16", today)).toBe("9月16日")
  })
})

describe("enumerateDates", () => {
  test("含头含尾，按天连着排", () => {
    expect(enumerateDates("2026-09-17", "2026-09-19")).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ])
  })

  test("跨月也能连上", () => {
    expect(enumerateDates("2026-09-30", "2026-10-02")).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ])
    expect(formatISODate(addDays(parseISODate("2026-09-30"), 1))).toBe(
      "2026-10-01"
    )
    expect(daysUntil("2026-10-02", "2026-09-30")).toBe(2)
  })

  test("结束早于开始则没有日子", () => {
    expect(enumerateDates("2026-09-19", "2026-09-17")).toEqual([])
  })
})
