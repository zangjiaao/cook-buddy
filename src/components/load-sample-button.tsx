import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useDb } from "@/hooks/use-db"
import { loadSampleData } from "@/lib/db/sample"

export function LoadSampleButton({
  onLoaded,
  className = "h-11",
}: {
  onLoaded?: (message: string) => void
  className?: string
}) {
  const { refresh } = useDb()
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    try {
      const added = await loadSampleData()
      refresh()
      onLoaded?.(
        added > 0
          ? "已载入示例。没改过的，可以到设置里清掉。"
          : "示例已经在了，没有再补。"
      )
    } catch (error) {
      console.error("载入示例失败", error)
      onLoaded?.("没能载入示例，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      disabled={busy}
      onClick={() => void load()}
    >
      {busy ? "正在载入…" : "载入示例"}
    </Button>
  )
}
