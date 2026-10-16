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

/** 与 styles.css 里 --background 同一颜色，给状态栏和启动画面用。 */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#090b0c",
}

export function applyThemeClass(
  root: { classList: { toggle: (token: string, force?: boolean) => boolean } },
  theme: Theme
): void {
  root.classList.toggle("dark", theme === "dark")
}

export function applyDocumentTheme(
  theme: Theme,
  root: {
    classList: { toggle: (token: string, force?: boolean) => boolean }
    style?: { backgroundColor: string; colorScheme: string }
  },
  meta?: { setAttribute: (name: string, value: string) => void } | null
): void {
  applyThemeClass(root, theme)
  const color = THEME_COLORS[theme]
  if (root.style) {
    root.style.backgroundColor = color
    root.style.colorScheme = theme
  }
  meta?.setAttribute("content", color)
}

const themeBootDark = JSON.stringify(THEME_COLORS.dark)
const themeBootLight = JSON.stringify(THEME_COLORS.light)

export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var root=document.documentElement;root.classList.toggle("dark",d);var c=d?${themeBootDark}:${themeBootLight};root.style.backgroundColor=c;root.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");(document.head||root).appendChild(m);}m.setAttribute("content",c);}catch(e){}})()`
