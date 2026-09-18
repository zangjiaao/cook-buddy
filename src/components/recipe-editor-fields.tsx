import { Field } from "@/components/field"
import { RecipeFavoriteButton } from "@/components/recipe-favorite-button"
import { RecipeIngredientRows } from "@/components/recipe-ingredient-rows"
import { RecipeTagPicker } from "@/components/recipe-tag-chips"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { EditableRecipeItem } from "@/lib/recipe-draft-items"
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
  steps: string
  items: EditableRecipeItem[]
  favorited: boolean
  tags: RecipeTag[]
  onNameChange: (value: string) => void
  onServingsChange: (value: string) => void
  onMinutesChange: (value: string) => void
  onStepsChange: (value: string) => void
  onItemsChange: (items: EditableRecipeItem[]) => void
  onFavoritedChange: (value: boolean) => void
  onTagsChange: (tags: RecipeTag[]) => void
}) {
  return (
    <>
      <Field label="名称">
        <Input
          className="h-12 text-base"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">常做</p>
        <RecipeFavoriteButton
          favorited={favorited}
          onToggle={() => onFavoritedChange(!favorited)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">标签</p>
        <RecipeTagPicker value={tags} onChange={onTagsChange} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="基准几人份">
          <Input
            className="h-12 text-base"
            inputMode="numeric"
            value={servings}
            onChange={(event) => onServingsChange(event.target.value)}
          />
        </Field>
        <Field label="大约几分钟">
          <Input
            className="h-12 text-base"
            inputMode="numeric"
            value={minutes}
            onChange={(event) => onMinutesChange(event.target.value)}
          />
        </Field>
      </div>
      <RecipeIngredientRows items={items} onChange={onItemsChange} />
      <Field label="步骤（一行一步）">
        <Textarea
          className="min-h-40 text-base leading-7"
          value={steps}
          onChange={(event) => onStepsChange(event.target.value)}
        />
      </Field>
    </>
  )
}
