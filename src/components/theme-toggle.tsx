import { RiMoonLine, RiSunLine } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const Icon = theme === "dark" ? RiMoonLine : RiSunLine

  return (
    <Button
      type="button"
      variant="outline"
      className="h-12 w-full justify-between px-4 text-base"
      onClick={toggle}
    >
      <span className="flex items-center gap-2">
        <Icon className="size-5" />
        {theme === "dark" ? "深色" : "浅色"}
      </span>
      <span className="text-sm text-muted-foreground">
        {theme === "dark" ? "点一下改浅色" : "点一下改深色"}
      </span>
    </Button>
  )
}
