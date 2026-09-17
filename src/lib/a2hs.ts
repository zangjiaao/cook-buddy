export const A2HS_DISMISS_STORAGE_KEY = "cookbuddy.a2hs.dismissedAt"
export const A2HS_DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000

const OTHER_IOS_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//

export type A2hsDisplayInput = {
  standalone?: boolean
  displayModeStandalone?: boolean
}

export type A2hsDismissInput = {
  dismissedAt?: number | null
  now?: number
  dismissTtlMs?: number
}

export type IosA2hsVisibilityInput = A2hsDisplayInput &
  A2hsDismissInput & {
    userAgent: string
    maxTouchPoints?: number
  }

export type AndroidA2hsVisibilityInput = A2hsDisplayInput &
  A2hsDismissInput & {
    hasDeferredPrompt: boolean
  }

export function isLikelyIosSafari(input: {
  userAgent: string
  maxTouchPoints?: number
}): boolean {
  const ua = input.userAgent
  if (!ua || OTHER_IOS_BROWSERS.test(ua)) return false
  if (/iPhone|iPod|iPad/.test(ua)) return true
  return /Macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1
}

export function isStandaloneDisplay(input: A2hsDisplayInput): boolean {
  return Boolean(input.standalone || input.displayModeStandalone)
}

export function wasDismissedRecently(input: A2hsDismissInput): boolean {
  const dismissedAt = input.dismissedAt
  if (dismissedAt == null || !Number.isFinite(dismissedAt)) return false
  const ttl = input.dismissTtlMs ?? A2HS_DISMISS_TTL_MS
  return (input.now ?? Date.now()) - dismissedAt < ttl
}

export function shouldShowIosA2hsTip(input: IosA2hsVisibilityInput): boolean {
  if (!isLikelyIosSafari(input)) return false
  if (isStandaloneDisplay(input)) return false
  return !wasDismissedRecently(input)
}

export function shouldShowAndroidInstallTip(
  input: AndroidA2hsVisibilityInput
): boolean {
  if (!input.hasDeferredPrompt) return false
  if (isStandaloneDisplay(input)) return false
  return !wasDismissedRecently(input)
}

export function parseDismissedAt(
  raw: string | null | undefined
): number | null {
  if (raw == null || raw === "") return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function readDismissedAt(
  storage: Pick<Storage, "getItem">
): number | null {
  return parseDismissedAt(storage.getItem(A2HS_DISMISS_STORAGE_KEY))
}

export function writeDismissedAt(
  storage: Pick<Storage, "setItem">,
  at: number
): void {
  storage.setItem(A2HS_DISMISS_STORAGE_KEY, String(at))
}
