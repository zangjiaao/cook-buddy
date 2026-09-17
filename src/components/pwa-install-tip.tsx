import { useEffect, useState } from "react"
import { RiCloseLine, RiShareForwardLine } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import {
  readDismissedAt,
  shouldShowAndroidInstallTip,
  shouldShowIosA2hsTip,
  writeDismissedAt,
} from "@/lib/a2hs"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    return null
  }
}

function readStandalone(): {
  standalone: boolean
  displayModeStandalone: boolean
} {
  const navigatorStandalone = Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone
  )
  const displayModeStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  return { standalone: navigatorStandalone, displayModeStandalone }
}

export function PwaInstallTip() {
  const [iosVisible, setIosVisible] = useState(false)
  const [androidVisible, setAndroidVisible] = useState(false)
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const storage = safeStorage()
    const dismissedAt = storage ? readDismissedAt(storage) : null
    const display = readStandalone()

    setIosVisible(
      shouldShowIosA2hsTip({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        dismissedAt,
        ...display,
      })
    )

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      const promptEvent = event as BeforeInstallPromptEvent
      setDeferredPrompt(promptEvent)
      setAndroidVisible(
        shouldShowAndroidInstallTip({
          hasDeferredPrompt: true,
          dismissedAt,
          ...display,
        })
      )
    }

    function onAppInstalled() {
      setAndroidVisible(false)
      setDeferredPrompt(null)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onAppInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onAppInstalled)
    }
  }, [])

  function dismiss() {
    const storage = safeStorage()
    if (storage) writeDismissedAt(storage, Date.now())
    setIosVisible(false)
    setAndroidVisible(false)
    setDeferredPrompt(null)
  }

  async function installAndroid() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome !== "accepted") {
      dismiss()
      return
    }
    setAndroidVisible(false)
    setDeferredPrompt(null)
  }

  if (iosVisible) {
    return (
      <aside
        aria-label="添加到主屏幕"
        className="border-b bg-background/95 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <RiShareForwardLine className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6 font-medium">
              把做饭搭子钉到主屏幕
            </p>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
              Safari 点底部分享，再选「添加到主屏幕」。下次开锅少翻一次。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-11 shrink-0"
            onClick={dismiss}
          >
            <RiCloseLine className="size-5" />
            <span className="sr-only">先不了</span>
          </Button>
        </div>
      </aside>
    )
  }

  if (androidVisible) {
    return (
      <aside
        aria-label="安装到主屏幕"
        className="border-b bg-background/95 px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6 font-medium">
              把做饭搭子装到主屏幕
            </p>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
              装好之后开锅直接戳图标，不用再翻浏览器。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              className="h-11 px-3 text-sm"
              onClick={() => void installAndroid()}
            >
              装上
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-3 text-sm"
              onClick={dismiss}
            >
              先不了
            </Button>
          </div>
        </div>
      </aside>
    )
  }

  return null
}
