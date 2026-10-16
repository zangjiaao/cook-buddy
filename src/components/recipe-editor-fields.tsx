import type { ReactNode } from "react"
import { RecipeFavoriteButton } from "@/components/recipe-favorite-button"
import { RecipeIngredientRows } from "@/components/recipe-ingredient-rows"
import { RecipeStepRows } from "@/components/recipe-step-rows"
import { RecipeTagPicker } from "@/components/recipe-tag-chips"
import { Input } from "@/components/ui/input"
import type {
  EditableRecipeItem,
  EditableRecipeStep,
} from "@/lib/recipe-draft-items"
import type { RecipeTag } from "@/lib/recipe-organize"

export function RecipeEditorFields({
  name,
  servings,
  minutes,
  steps,
  items,
  favorited,
  tags,
  onNameChange,
  onServingsChange,
  onMinutesChange,
  onStepsChange,
  onItemsChange,
  onFavoritedChange,
  onTagsChange,
}: {
  name: string
  servings: string
  minutes: string
  steps: EditableRecipeStep[]
  items: EditableRecipeItem[]
  favorited: boolean
  tags: RecipeTag[]
  onNameChange: (value: string) => void
  onServingsChange: (value: string) => void
  onMinutesChange: (value: string) => void
  onStepsChange: (steps: EditableRecipeStep[]) => void
  onItemsChange: (items: EditableRecipeItem[]) => void
  onFavoritedChange: (value: boolean) => void
  onTagsChange: (tags: RecipeTag[]) => void
}) {
  return (
    <div className="flex flex-col">
      <EditorSection title="基本信息">
        <div className="flex items-center gap-2 border-t border-b border-border py-2">
          <Input
            className="h-11 min-w-0 flex-1 text-base md:text-base"
            placeholder="名称"
            aria-label="名称"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <RecipeFavoriteButton
            favorited={favorited}
            compact
            onToggle={() => onFavoritedChange(!favorited)}
            className="h-11 shrink-0 px-3 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-border py-2">
          <Input
            className="h-11 text-base md:text-base"
            inputMode="numeric"
            placeholder="几人份"
            aria-label="几人份"
            value={servings}
            onChange={(event) => onServingsChange(event.target.value)}
          />
          <Input
            className="h-11 text-base md:text-base"
            inputMode="numeric"
            placeholder="大约几分钟"
            aria-label="大约几分钟"
            value={minutes}
            onChange={(event) => onMinutesChange(event.target.value)}
          />
        </div>
        <div className="border-b border-border py-3">
          <RecipeTagPicker
            value={tags}
            onChange={onTagsChange}
            showHint={false}
          />
        </div>
      </EditorSection>
      <EditorSection title="用料" spaced>
        <RecipeIngredientRows items={items} onChange={onItemsChange} />
      </EditorSection>
      <EditorSection title="步骤" spaced>
        <RecipeStepRows steps={steps} onChange={onStepsChange} />
      </EditorSection>
    </div>
  )
}

function EditorSection({
  title,
  children,
  spaced,
}: {
  title: string
  children: ReactNode
  spaced?: boolean
}) {
  return (
    <section className={spaced ? "mt-6" : "mt-2"}>
      <h2 className="px-1 pb-2 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}
