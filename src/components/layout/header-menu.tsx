import type { ReactNode } from "react"
import { RiMore2Line } from "@remixicon/react"

export function HeaderMenu({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <details className="relative">
      <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden [&::marker]:hidden">
        <RiMore2Line className="size-5" />
        <span className="sr-only">{label}</span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-36 rounded-lg border bg-background py-1 shadow-md">
        {children}
      </div>
    </details>
  )
}
