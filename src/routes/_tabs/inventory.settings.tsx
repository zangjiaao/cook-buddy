import { useRef, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useServerFn } from "@tanstack/react-start"
import { suggestIngredientCleanup } from "@/lib/ai/ingredient-cleanup.functions"
import { LoadSampleButton } from "@/components/load-sample-button"
import { useDb } from "@/hooks/use-db"
import { clearUnmodifiedSampleData } from "@/lib/db/sample"
import {
  BACKUP_SCHEMA_VERSION,
  backupFileName,
  backupStoreCounts,
  parseBackup,
  serializeBackup,
  storeLabel,
  triggerJsonDownload,
} from "@/lib/backup"
import type { BackupFile } from "@/lib/backup"
import {
  exportBackup,
  regenerateShoppingFromPlan,
  replaceFromBackup,
} from "@/lib/db/repos"
import { runStoredIngredientCleanup } from "@/lib/ingredient-cleanup-run"
import { STORE_NAMES } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  const { refresh } = useDb()
  const suggestCleanup = useServerFn(suggestIngredientCleanup)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmClearSample, setConfirmClearSample] = useState(false)

  async function onExport() {
    setBusy(true)
    setNotice("")
    try {
      const backup = await exportBackup()
      triggerJsonDownload(
        backupFileName(backup.exportedAt),
        serializeBackup(backup)
      )
      setNotice("备份文件已开始下载。")
    } catch {
      setNotice("导出没成功，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setNotice("")
    setConfirmReplace(false)
    try {
      const result = parseBackup(await file.text())
      if (!result.ok) {
        setPending(null)
        setNotice(result.reason)
        return
      }
      setPending(result.backup)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function onReplace() {
    if (!pending) return
    if (!confirmReplace) {
      setConfirmReplace(true)
      return
    }
    setBusy(true)
    try {
      await replaceFromBackup(pending)
      await runStoredIngredientCleanup({
        suggest: (ingredients) => suggestCleanup({ data: { ingredients } }),
      })
      await regenerateShoppingFromPlan()
      setPending(null)
      setConfirmReplace(false)
      refresh()
      setNotice("已经换成这份备份里的数据。")
    } catch {
      setNotice("导入没成功，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  async function onClearSample() {
    if (!confirmClearSample) {
      setConfirmClearSample(true)
      return
    }
    setBusy(true)
    setNotice("")
    try {
      const removed = await clearUnmodifiedSampleData()
      refresh()
      setNotice(
        removed > 0
          ? `已清掉 ${removed} 条没改过的示例。改过的，和被自己菜谱用到的食材，都留着。`
          : "没有能清掉的示例。改过的和被菜谱用到的食材都留着。"
      )
    } catch (error) {
      console.error("清除示例失败", error)
      setNotice("没能清掉示例，请再试一次。")
    } finally {
      setConfirmClearSample(false)
      setBusy(false)
    }
  }

  const counts = pending ? backupStoreCounts(pending.stores) : null

  return (
    <>
      <PageHeader
        title="设置"
        subtitle="换外观，或把本机数据备份成文件。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/inventory" />}
          >
            返回
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-medium">外观</p>
            <p className="text-sm leading-6 text-muted-foreground">
              没选过时跟系统。点过一次就记住。
            </p>
            <ThemeToggle />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-medium">示例数据</p>
            <p className="text-sm leading-6 text-muted-foreground">
              启动时不会自动写入示例。载入只会补上还没有的示例编号，不会覆盖你改过的。清除只删没改过的，被自己菜谱用到的食材档案会留下。
            </p>
            <LoadSampleButton
              className="h-12 w-full text-base"
              onLoaded={setNotice}
            />
            <Button
              type="button"
              variant="destructive"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={() => void onClearSample()}
            >
              {confirmClearSample ? "确认清除没改过的示例" : "清除示例数据"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-medium">数据备份</p>
            <p className="text-sm leading-6 text-muted-foreground">
              导出当前 IndexedDB 里的食材、库存、食谱、计划、清单。文件版本 v
              {BACKUP_SCHEMA_VERSION}。导入会整份替换，原来的数据回不来。
            </p>
            <Button
              type="button"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={() => void onExport()}
            >
              导出备份
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => void onPickFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              导入备份
            </Button>
            {pending && counts ? (
              <div className="space-y-3 rounded-lg border px-3 py-3">
                <p className="text-sm leading-6">
                  这份备份会清掉现在的数据，再写入：
                </p>
                <ul className="text-sm leading-6 text-muted-foreground">
                  {STORE_NAMES.map((name) => (
                    <li key={name}>
                      {storeLabel[name]} {counts[name]} 条
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-12 w-full text-base"
                  disabled={busy}
                  onClick={() => void onReplace()}
                >
                  {confirmReplace ? "确认替换全部数据" : "用这份备份替换"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-full"
                  disabled={busy}
                  onClick={() => {
                    setPending(null)
                    setConfirmReplace(false)
                  }}
                >
                  取消
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        {notice ? (
          <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
        ) : null}
      </div>
    </>
  )
}
