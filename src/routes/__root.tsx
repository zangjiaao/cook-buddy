import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { PwaRegister } from "@/components/pwa-register"
import { AccountProvider } from "@/hooks/use-account"
import { DbProvider } from "@/hooks/use-db"
import { THEME_BOOT_SCRIPT, THEME_COLORS } from "@/lib/theme"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "做饭搭子" },
      {
        name: "description",
        content: "库存 → 计划 → 菜市场清单 → 入库 → 做菜扣库存",
      },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "apple-mobile-web-app-title", content: "做饭搭子" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto min-h-dvh max-w-lg bg-background p-6 pt-[calc(env(safe-area-inset-top)+4rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <h1 className="text-xl font-semibold">没有这页</h1>
      <p className="mt-2 text-muted-foreground">回库存看看家里还有什么。</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="theme-color" content={THEME_COLORS.light} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-background"
        />
        <DbProvider>
          <AccountProvider>
            {children}
            <PwaRegister />
          </AccountProvider>
        </DbProvider>
        <Scripts />
      </body>
    </html>
  )
}
