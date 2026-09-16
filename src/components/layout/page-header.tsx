import type { ReactNode } from "react"
import { cn } from "cn"

export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-start justify-between gap-3 bg-background/95 px-4 pt-5 pb-3 backdrop-blur",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  )
}
