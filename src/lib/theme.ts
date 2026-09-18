export const THEME_STORAGE_KEY = "cookbuddy.theme"

export const THEMES = ["light", "dark"] as const
export type Theme = (typeof THEMES)[number]
export type ThemePreference = Theme | "system"

export function parseThemePreference(
  raw: string | null | undefined
): ThemePreference {
  if (raw === "light" || raw === "dark") return raw
  return "system"
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean
): Theme {
  if (preference === "system") return systemDark ? "dark" : "light"
  return preference
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark"
}

export function readThemePreference(
  storage: Pick<Storage, "getItem"> | null
): ThemePreference {
  if (!storage) return "system"
  return parseThemePreference(storage.getItem(THEME_STORAGE_KEY))
}

export function writeThemePreference(
  storage: Pick<Storage, "setItem"> | null,
  preference: Theme
): void {
  storage?.setItem(THEME_STORAGE_KEY, preference)
}

export function themeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    return null
  }
}

export function prefersColorSchemeDark(
  media: { matches: boolean } | null = null
): boolean {
  return Boolean(media?.matches)
}

export function applyThemeClass(
  root: { classList: { toggle: (token: string, force?: boolean) => boolean } },
  theme: Theme
): void {
  root.classList.toggle("dark", theme === "dark")
}

export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})()`
