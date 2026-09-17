import { describe, expect, test } from "vitest"
import {
  A2HS_DISMISS_STORAGE_KEY,
  A2HS_DISMISS_TTL_MS,
  isLikelyIosSafari,
  isStandaloneDisplay,
  parseDismissedAt,
  readDismissedAt,
  shouldShowAndroidInstallTip,
  shouldShowIosA2hsTip,
  wasDismissedRecently,
  writeDismissedAt,
} from "@/lib/a2hs"

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
const IPADOS_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1"
const IPHONE_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15"
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_779_000_000_000

describe("isLikelyIosSafari", () => {
  test("iPhone / iPad Safari 算", () => {
    expect(isLikelyIosSafari({ userAgent: IPHONE_SAFARI })).toBe(true)
    expect(isLikelyIosSafari({ userAgent: IPAD_SAFARI })).toBe(true)
  })

  test("iPadOS 桌面 UA 靠多点触控判断", () => {
    expect(
      isLikelyIosSafari({ userAgent: IPADOS_DESKTOP_UA, maxTouchPoints: 5 })
    ).toBe(true)
    expect(
      isLikelyIosSafari({ userAgent: IPADOS_DESKTOP_UA, maxTouchPoints: 0 })
    ).toBe(false)
  })

  test("iOS 上的 Chrome / Firefox 不算 Safari", () => {
    expect(isLikelyIosSafari({ userAgent: IPHONE_CHROME })).toBe(false)
    expect(isLikelyIosSafari({ userAgent: IPHONE_FIREFOX })).toBe(false)
  })

  test("Android 不算", () => {
    expect(isLikelyIosSafari({ userAgent: ANDROID_CHROME })).toBe(false)
  })
})

describe("isStandaloneDisplay", () => {
  test("主屏幕打开或 display-mode standalone 都算已安装", () => {
    expect(isStandaloneDisplay({ standalone: true })).toBe(true)
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true)
    expect(isStandaloneDisplay({})).toBe(false)
  })
})

describe("wasDismissedRecently", () => {
  test("没有记录或坏数据不算最近关掉过", () => {
    expect(wasDismissedRecently({ now: NOW })).toBe(false)
    expect(wasDismissedRecently({ dismissedAt: Number.NaN, now: NOW })).toBe(
      false
    )
  })

  test("14 天内关掉过不再弹", () => {
    expect(
      wasDismissedRecently({
        dismissedAt: NOW - DAY,
        now: NOW,
        dismissTtlMs: A2HS_DISMISS_TTL_MS,
      })
    ).toBe(true)
    expect(
      wasDismissedRecently({
        dismissedAt: NOW - A2HS_DISMISS_TTL_MS + 1,
        now: NOW,
      })
    ).toBe(true)
  })

  test("过了冷静期可以再提一次", () => {
    expect(
      wasDismissedRecently({
        dismissedAt: NOW - A2HS_DISMISS_TTL_MS,
        now: NOW,
      })
    ).toBe(false)
    expect(
      wasDismissedRecently({
        dismissedAt: NOW - 21 * DAY,
        now: NOW,
      })
    ).toBe(false)
  })
})

describe("shouldShowIosA2hsTip", () => {
  test("Safari 浏览器、还没装到主屏幕、没刚关掉，就显示", () => {
    expect(
      shouldShowIosA2hsTip({
        userAgent: IPHONE_SAFARI,
        now: NOW,
      })
    ).toBe(true)
  })

  test("已经在独立窗口 / 主屏幕里不显示", () => {
    expect(
      shouldShowIosA2hsTip({
        userAgent: IPHONE_SAFARI,
        standalone: true,
        now: NOW,
      })
    ).toBe(false)
    expect(
      shouldShowIosA2hsTip({
        userAgent: IPHONE_SAFARI,
        displayModeStandalone: true,
        now: NOW,
      })
    ).toBe(false)
  })

  test("最近关掉过不纠缠", () => {
    expect(
      shouldShowIosA2hsTip({
        userAgent: IPHONE_SAFARI,
        dismissedAt: NOW - 2 * DAY,
        now: NOW,
      })
    ).toBe(false)
  })

  test("不是 iOS Safari 不显示", () => {
    expect(shouldShowIosA2hsTip({ userAgent: ANDROID_CHROME, now: NOW })).toBe(
      false
    )
    expect(shouldShowIosA2hsTip({ userAgent: IPHONE_CHROME, now: NOW })).toBe(
      false
    )
  })
})

describe("shouldShowAndroidInstallTip", () => {
  test("有 beforeinstallprompt 且未安装、未关掉才显示", () => {
    expect(
      shouldShowAndroidInstallTip({
        hasDeferredPrompt: true,
        now: NOW,
      })
    ).toBe(true)
  })

  test("没有系统安装事件就不显示自定义条", () => {
    expect(
      shouldShowAndroidInstallTip({
        hasDeferredPrompt: false,
        now: NOW,
      })
    ).toBe(false)
  })

  test("已装到主屏幕或刚关掉则不显示", () => {
    expect(
      shouldShowAndroidInstallTip({
        hasDeferredPrompt: true,
        displayModeStandalone: true,
        now: NOW,
      })
    ).toBe(false)
    expect(
      shouldShowAndroidInstallTip({
        hasDeferredPrompt: true,
        dismissedAt: NOW - DAY,
        now: NOW,
      })
    ).toBe(false)
  })
})

describe("dismissedAt storage helpers", () => {
  test("读写 localStorage 形态的时间戳", () => {
    const data: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value
      },
    }
    expect(readDismissedAt(storage)).toBeNull()
    writeDismissedAt(storage, NOW)
    expect(data[A2HS_DISMISS_STORAGE_KEY]).toBe(String(NOW))
    expect(readDismissedAt(storage)).toBe(NOW)
  })

  test("坏值当成没关掉过", () => {
    expect(parseDismissedAt(null)).toBeNull()
    expect(parseDismissedAt("")).toBeNull()
    expect(parseDismissedAt("nope")).toBeNull()
  })
})
