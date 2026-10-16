import { useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@/components/ui/button"
import { useAccount } from "@/hooks/use-account"
import { useDb } from "@/hooks/use-db"
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh"
import {
  closeRecipeShare,
  createRecipeShare,
  getRecipeHelpDesk,
} from "@/lib/recipe-help.functions"
import { formatHelpWhen, snapshotFromRecipe } from "@/lib/recipe-help"
import type { ShareLinkRecord } from "@/lib/recipe-help-store"
import type { Recipe, RecipeItem } from "@/lib/types"

export function RecipeHelpCard({
  recipe,
  items,
  choosing,
  onPendingCount,
}: {
  recipe: Recipe
  items: RecipeItem[]
  choosing: boolean
  onPendingCount?: (count: number) => void
}) {
  const account = useAccount()
  const { revision } = useDb()
  const createShare = useServerFn(createRecipeShare)
  const loadDesk = useServerFn(getRecipeHelpDesk)
  const closeShare = useServerFn(closeRecipeShare)
  const [links, setLinks] = useState<ShareLinkRecord[]>([])
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState<"" | "link" | "close">("")
  const [confirmClose, setConfirmClose] = useState("")
  const [showClosed, setShowClosed] = useState(false)

  const applyDesk = useCallback(
    (nextLinks: ShareLinkRecord[], count: number) => {
      setLinks(nextLinks)
      onPendingCount?.(count)
    },
    [onPendingCount]
  )

  const refreshDesk = useCallback(async () => {
    const result = await loadDesk({ data: { recipeId: recipe.id } })
    if (!result.ok) {
      setNotice(result.reason)
      return
    }
    applyDesk(result.links, result.pendingCount)
  }, [applyDesk, loadDesk, recipe.id])

  useEffect(() => {
    if (!account.user) {
      onPendingCount?.(0)
      return
    }
    let cancelled = false
    loadDesk({ data: { recipeId: recipe.id } })
      .then((result) => {
        if (cancelled || !result.ok) return
        applyDesk(result.links, result.pendingCount)
      })
      .catch(() => {
        if (!cancelled) setNotice("帮改链接没读出来。")
      })
    return () => {
      cancelled = true
    }
  }, [
    account.user,
    account.lastSyncAt,
    applyDesk,
    loadDesk,
    onPendingCount,
    recipe.id,
    revision,
  ])

  useEffect(() => {
    if (!choosing) setShowClosed(false)
  }, [choosing])

  useForegroundRefresh(() => {
    void refreshDesk()
  }, Boolean(account.user))

  async function createLink(allowSuggestions: boolean) {
    setNotice("")
    const snapshot = snapshotFromRecipe(recipe, items)
    if (!snapshot.ok) {
      setNotice(snapshot.reason)
      return
    }
    setBusy("link")
    try {
      const result = await createShare({
        data: {
          recipeId: recipe.id,
          snapshot: snapshot.value,
          allowSuggestions,
        },
      })
      if (!result.ok) {
        setNotice(result.reason)
        return
      }
      setNotice(
        allowSuggestions
          ? "链接已生成。意见收到 7 天，链接本身一直有效。"
          : "链接已生成，只能看和收藏。"
      )
      await refreshDesk()
    } catch {
      setNotice("链接没生成，请再试一次。")
    } finally {
      setBusy("")
    }
  }

  async function copyLink(token: string) {
    const ok = await copyText(helpUrl(token))
    setNotice(ok ? "链接已复制。" : "没复制上，请长按链接再试。")
  }

  async function shareLink(token: string) {
    const url = helpUrl(token)
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: recipe.name,
          text: `看看「${recipe.name}」`,
          url,
        })
        setNotice("已打开系统分享。")
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }
    const ok = await copyText(url)
    setNotice(ok ? "已复制，可以粘贴到微信。" : "这台设备分享不了。")
  }

  async function closeLink(token: string) {
    if (confirmClose !== token) {
      setConfirmClose(token)
      return
    }
    setBusy("close")
    setNotice("")
    try {
      const result = await closeShare({ data: { token } })
      setNotice(result.ok ? "链接已关闭。" : result.reason)
      if (result.ok) {
        setConfirmClose("")
        await refreshDesk()
      }
    } catch {
      setNotice("没关掉，请再试一次。")
    } finally {
      setBusy("")
    }
  }

  if (!choosing) return null

  const openLinks = links.filter((link) => link.status === "open")
  const closedLinks = links.filter((link) => link.status === "closed")

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-4">
      {account.loading ? (
        <p className="text-sm leading-6 text-muted-foreground">读取账号…</p>
      ) : account.user ? (
        <>
          <p className="text-sm leading-6 text-muted-foreground">
            发一个长期有效的链接。对方可以看完整食谱，也可以存成自己的一份。需要的话，7
            天内还能提修改意见。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 px-2 text-sm"
              disabled={busy !== ""}
              onClick={() => void createLink(false)}
            >
              {busy === "link" ? "正在生成…" : "只给看和收藏"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-2 text-sm"
              disabled={busy !== ""}
              onClick={() => void createLink(true)}
            >
              {busy === "link" ? "正在生成…" : "也允许提修改意见"}
            </Button>
          </div>
          {openLinks.length > 0 ? (
            <ul className="border-t border-border">
              {openLinks.map((link) => (
                <li
                  key={link.token}
                  className="space-y-2 border-b border-border py-3"
                >
                  <p className="text-sm leading-6">
                    {linkSummary(link)}
                    {link.pendingCount > 0
                      ? ` · 待确认 ${link.pendingCount} 条`
                      : ""}
                  </p>
                  <p className="text-sm leading-6 break-all text-muted-foreground">
                    /help/{link.token}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 px-2 text-sm"
                      onClick={() => void copyLink(link.token)}
                    >
                      复制
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 px-2 text-sm"
                      onClick={() => void shareLink(link.token)}
                    >
                      发给微信
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 px-2 text-sm"
                      disabled={busy !== ""}
                      onClick={() => void closeLink(link.token)}
                    >
                      {confirmClose === link.token ? "确认关闭" : "关闭"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {closedLinks.length > 0 ? (
            <div className="border-t border-border">
              <button
                type="button"
                className="flex h-11 w-full items-center px-1 text-sm text-muted-foreground"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((current) => !current)}
              >
                已关闭 {closedLinks.length} 个
              </button>
              {showClosed ? (
                <ul>
                  {closedLinks.map((link) => (
                    <li
                      key={link.token}
                      className="border-t border-border py-3 text-sm leading-6"
                    >
                      {linkSummary(link)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          请先登录，才能分享这道菜。
          <Link
            to="/inventory/settings"
            className="ml-1 text-primary-foreground"
          >
            去登录
          </Link>
        </p>
      )}
      {notice ? (
        <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
      ) : null}
    </div>
  )
}

function linkSummary(link: ShareLinkRecord): string {
  const saved = `已保存 ${link.saveCount} 次`
  if (link.status === "closed") return `已关闭 · ${saved}`
  if (!link.allowSuggestions) return `只给看和收藏 · ${saved}`
  if (link.suggestionsOpen && link.helpExpiresAt) {
    return `意见收到 ${formatHelpWhen(link.helpExpiresAt)} · ${saved}`
  }
  return `意见已截止 · ${saved}`
}

function helpUrl(token: string): string {
  if (typeof window === "undefined") return `/help/${token}`
  return `${window.location.origin}/help/${token}`
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const area = document.createElement("textarea")
      area.value = value
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand("copy")
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
