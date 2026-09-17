import { Link, useRouterState } from "@tanstack/react-router"
import {
  RiBook2Line,
  RiCalendarScheduleLine,
  RiFridgeLine,
  RiShoppingBag3Line,
} from "@remixicon/react"
import { cn } from "cn"
import type { ReactNode } from "react"
import { PwaInstallTip } from "@/components/pwa-install-tip"

const TABS = [
  { to: "/inventory", label: "库存", icon: RiFridgeLine },
  { to: "/recipes", label: "食谱", icon: RiBook2Line },
  { to: "/plan", label: "计划", icon: RiCalendarScheduleLine },
  { to: "/shopping", label: "清单", icon: RiShoppingBag3Line },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col bg-background">
      <PwaInstallTip />
      <div className="flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <nav
        aria-label="主导航"
        className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="grid grid-cols-4">
          {TABS.map((tab) => {
            const active =
              pathname === tab.to || pathname.startsWith(`${tab.to}/`)
            const Icon = tab.icon
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-medium",
                    active
                      ? "text-primary-foreground/90"
                      : "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full",
                      active && "bg-primary text-primary-foreground"
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
