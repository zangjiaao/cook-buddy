import { useEffect, useRef } from "react"

export function useForegroundRefresh(refresh: () => void, enabled = true) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return
    const run = () => {
      if (document.visibilityState === "hidden") return
      refreshRef.current()
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return
      refreshRef.current()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", run)
    window.addEventListener("pageshow", run)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", run)
      window.removeEventListener("pageshow", run)
    }
  }, [enabled])
}
