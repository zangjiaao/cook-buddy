import { cn } from "cn"
import {
  RECIPE_TAG_FILTERS,
  RECIPE_TAG_HINT,
  RECIPE_TAGS,
  recipeTagFilterLabel,
  recipeTagLabel,
  toggleRecipeTag,
} from "@/lib/recipe-organize"
import type { RecipeTag, RecipeTagFilter } from "@/lib/recipe-organize"

export function RecipeTagFilterChips({
  value,
  onChange,
}: {
  value: RecipeTagFilter
  onChange: (next: RecipeTagFilter) => void
}) {
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="按标签筛选"
        className="flex flex-wrap gap-2"
      >
        {RECIPE_TAG_FILTERS.map((filter) => {
          const selected = filter === value
          return (
            <button
              key={filter}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn(
                "inline-flex h-11 min-w-14 items-center justify-center rounded-full px-4 text-sm font-medium",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
              onClick={() => onChange(filter)}
            >
              {recipeTagFilterLabel(filter)}
            </button>
          )
        })}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {RECIPE_TAG_HINT}
      </p>
    </div>
  )
}

export function RecipeTagPicker({
  value,
  onChange,
  disabled,
  showHint = true,
  compact = false,
  className,
}: {
  value: readonly string[]
  onChange: (next: RecipeTag[]) => void
  disabled?: boolean
  showHint?: boolean
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn(showHint && "space-y-2", className)}>
      <div
        className={cn("flex flex-wrap", compact ? "gap-1.5" : "gap-2")}
        aria-label="食谱标签"
      >
        {RECIPE_TAGS.map((tag) => {
          const selected = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              className={cn(
                "inline-flex items-center justify-center rounded-full font-medium disabled:opacity-50",
                compact
                  ? "h-10 min-w-10 px-3 text-xs"
                  : "h-11 min-w-14 px-4 text-sm",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
              onClick={() => onChange(toggleRecipeTag(value, tag))}
            >
              {recipeTagLabel[tag]}
            </button>
          )
        })}
      </div>
      {showHint ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {RECIPE_TAG_HINT}
        </p>
      ) : null}
    </div>
  )
}
