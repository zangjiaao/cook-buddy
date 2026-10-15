import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, fieldControlClass } from "@/components/field"
import { useAccount } from "@/hooks/use-account"

function formatSyncTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("zh-CN", { hour12: false })
}

export function AccountPanel() {
  const account = useAccount()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError("")
    if (!email.trim() || !password) {
      setError("请填写邮箱和密码。")
      return
    }
    if (password.length < 8) {
      setError("密码至少 8 位。")
      return
    }
    setBusy(true)
    try {
      const message =
        mode === "login"
          ? await account.signIn(email, password)
          : await account.signUp({ email, password, name })
      if (message) setError(message)
      else setPassword("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-lg font-medium">账号</p>
      <p className="text-sm leading-6 text-muted-foreground">
        没登录时，菜谱、库存、计划和清单只留在这台设备上。登录后会自动同步：打开、回到前台或网络恢复时按更新时间合并，前台大约每
        30 秒再拉一次。
      </p>
      {account.loading ? (
        <p className="text-sm leading-6 text-muted-foreground">正在读取账号…</p>
      ) : account.user ? (
        <div className="space-y-3">
          <p className="text-base leading-6">
            当前账号 {account.user.email}
            {account.user.name ? `（${account.user.name}）` : ""}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {account.lastSyncAt
              ? `上次同步 ${formatSyncTime(account.lastSyncAt)}`
              : "登录后会自动同步。"}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full text-sm text-muted-foreground"
            disabled={account.syncing}
            onClick={() => void account.syncNow()}
          >
            {account.syncing ? "正在同步…" : "立即同步"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full text-base"
            disabled={account.syncing}
            onClick={() => void account.signOut()}
          >
            退出
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "login" ? "default" : "outline"}
              className="h-11"
              onClick={() => {
                setMode("login")
                setError("")
              }}
            >
              登录
            </Button>
            <Button
              type="button"
              variant={mode === "register" ? "default" : "outline"}
              className="h-11"
              onClick={() => {
                setMode("register")
                setError("")
              }}
            >
              注册
            </Button>
          </div>
          <Field label="邮箱">
            <Input
              className={fieldControlClass}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="密码">
            <Input
              className={fieldControlClass}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {mode === "register" ? (
            <Field label="称呼（可空）">
              <Input
                className={fieldControlClass}
                autoComplete="nickname"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          ) : null}
          <Button
            type="button"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={() => void onSubmit()}
          >
            {busy ? "请稍等…" : mode === "login" ? "登录" : "注册"}
          </Button>
        </div>
      )}
      {error ? (
        <p className="text-sm leading-6 text-destructive">{error}</p>
      ) : null}
      {account.notice ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {account.notice}
        </p>
      ) : null}
    </div>
  )
}
