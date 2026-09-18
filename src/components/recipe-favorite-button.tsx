import { RiPushpinFill, RiPushpinLine } from "@remixicon/react"
import { Button } from "@/components/ui/button"

export function RecipeFavoriteButton({
  favorited,
  onToggle,
  disabled,
  className,
  compact,
}: {
  favorited: boolean
  onToggle: () => void
  disabled?: boolean
  className?: string
  compact?: boolean
}) {
  return (
    <Button
      type="button"
      variant={favorited ? "secondary" : "outline"}
      className={className ?? "h-11 px-4 text-sm"}
      disabled={disabled}
      aria-pressed={favorited}
      aria-label={favorited ? "取消常做" : "钉到常做"}
      onClick={onToggle}
    >
      {favorited ? (
        <RiPushpinFill className="size-4" aria-hidden />
      ) : (
        <RiPushpinLine className="size-4" aria-hidden />
      )}
      {compact ? "常做" : favorited ? "常做中" : "钉到常做"}
    </Button>
  )
}
