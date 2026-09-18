import { describe, expect, test } from "vitest"
import {
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeClass,
  nextTheme,
  parseThemePreference,
  prefersColorSchemeDark,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from "@/lib/theme"

describe("theme preference", () => {
  test("没存过或坏值都跟系统", () => {
    expect(parseThemePreference(null)).toBe("system")
    expect(parseThemePreference("")).toBe("system")
    expect(parseThemePreference("nope")).toBe("system")
    expect(parseThemePreference("light")).toBe("light")
    expect(parseThemePreference("dark")).toBe("dark")
  })

  test("没选过时跟系统，点过之后记住", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  test("按钮在浅色和深色之间切换", () => {
    expect(nextTheme("light")).toBe("dark")
    expect(nextTheme("dark")).toBe("light")
  })

  test("读写 localStorage 形态的偏好", () => {
    const data: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value
      },
    }
    expect(readThemePreference(storage)).toBe("system")
    writeThemePreference(storage, "dark")
    expect(data[THEME_STORAGE_KEY]).toBe("dark")
    expect(readThemePreference(storage)).toBe("dark")
  })

  test("系统媒体查询只看 matches", () => {
    expect(prefersColorSchemeDark({ matches: true })).toBe(true)
    expect(prefersColorSchemeDark({ matches: false })).toBe(false)
    expect(prefersColorSchemeDark(null)).toBe(false)
  })

  test("在 html 上加减 dark class", () => {
    const tokens = new Set<string>()
    const root = {
      classList: {
        toggle(token: string, force?: boolean) {
          if (force) tokens.add(token)
          else tokens.delete(token)
          return force ?? false
        },
      },
    }
    applyThemeClass(root, "dark")
    expect(tokens.has("dark")).toBe(true)
    applyThemeClass(root, "light")
    expect(tokens.has("dark")).toBe(false)
  })

  test("启动脚本带上同一把存储键", () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY)
    expect(THEME_BOOT_SCRIPT).toContain("classList.toggle")
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: dark")
  })
})
