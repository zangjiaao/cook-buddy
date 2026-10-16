import { useCallback, useEffect, useState } from "react"
import {
  applyDocumentTheme,
  nextTheme,
  prefersColorSchemeDark,
  readThemePreference,
  resolveTheme,
  themeStorage,
  writeThemePreference,
} from "@/lib/theme"
import type { Theme } from "@/lib/theme"

function currentSystemDark(): boolean {
  if (typeof window === "undefined") return false
  return prefersColorSchemeDark(
    window.matchMedia("(prefers-color-scheme: dark)")
  )
}

function resolvedTheme(): Theme {
  return resolveTheme(readThemePreference(themeStorage()), currentSystemDark())
}

function paintTheme(theme: Theme) {
  applyDocumentTheme(
    theme,
    document.documentElement,
    document.querySelector('meta[name="theme-color"]')
  )
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    const next = resolvedTheme()
    setTheme(next)
    paintTheme(next)

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (readThemePreference(themeStorage()) !== "system") return
      const systemTheme = resolveTheme("system", media.matches)
      setTheme(systemTheme)
      paintTheme(systemTheme)
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current)
      writeThemePreference(themeStorage(), next)
      paintTheme(next)
      return next
    })
  }, [])

  return { theme, toggle }
}
