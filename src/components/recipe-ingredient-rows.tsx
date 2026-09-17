import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addEditableRecipeItem,
  removeEditableRecipeItem,
  updateEditableRecipeItem,
  type EditableRecipeItem,
} from "@/lib/recipe-draft-items"

export function RecipeIngredientRows({
  items,
  onChange,
}: {
  items: EditableRecipeItem[]
  onChange: (items: EditableRecipeItem[]) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">食材</p>
      {items.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          还没有食材。要做这道菜，先加上一味。
        </p>
      ) : null}
      {items.map((item, index) => (
        <div key={item.key} className="space-y-2 rounded-lg border p-3">
          <Input
            className="h-12 text-base"
            placeholder="食材名"
            aria-label={`食材 ${index + 1} 名称`}
            value={item.rawName}
            onChange={(event) =>
              onChange(
                updateEditableRecipeItem(items, item.key, {
                  rawName: event.target.value,
                })
              )
            }
          />
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input
              className="h-12 text-base"
              inputMode="decimal"
              placeholder="数量"
              aria-label={`食材 ${index + 1} 数量`}
              value={item.quantity}
              onChange={(event) =>
                onChange(
                  updateEditableRecipeItem(items, item.key, {
                    quantity: event.target.value,
                  })
                )
              }
            />
            <Input
              className="h-12 text-base"
              placeholder="单位"
              aria-label={`食材 ${index + 1} 单位`}
              value={item.unit}
              onChange={(event) =>
                onChange(
                  updateEditableRecipeItem(items, item.key, {
                    unit: event.target.value,
                  })
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              className="h-12 px-3 text-sm"
              onClick={() =>
                onChange(removeEditableRecipeItem(items, item.key))
              }
            >
              去掉
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base"
        onClick={() => onChange(addEditableRecipeItem(items))}
      >
        加上一味
      </Button>
    </div>
  )
}
