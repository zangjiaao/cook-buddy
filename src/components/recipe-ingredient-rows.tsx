import { RiCloseLine } from "@remixicon/react"
import { Input } from "@/components/ui/input"
import {
  addEditableRecipeItem,
  removeEditableRecipeItem,
  updateEditableRecipeItem,
} from "@/lib/recipe-draft-items"
import type { EditableRecipeItem } from "@/lib/recipe-draft-items"

export function RecipeIngredientRows({
  items,
  onChange,
}: {
  items: EditableRecipeItem[]
  onChange: (items: EditableRecipeItem[]) => void
}) {
  return (
    <ul className="border-t border-border">
      {items.map((item, index) => (
        <li
          key={item.key}
          className="flex items-center gap-1 border-b border-border"
        >
          <Input
            className="h-11 min-w-0 flex-1 text-base"
            placeholder="名称"
            aria-label={`用料 ${index + 1} 名称`}
            value={item.rawName}
            onChange={(event) =>
              onChange(
                updateEditableRecipeItem(items, item.key, {
                  rawName: event.target.value,
                })
              )
            }
          />
          <Input
            className="h-11 w-16 shrink-0 text-base"
            inputMode="decimal"
            placeholder="数量"
            aria-label={`用料 ${index + 1} 数量`}
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
            className="h-11 w-14 shrink-0 text-base"
            placeholder="单位"
            aria-label={`用料 ${index + 1} 单位`}
            value={item.unit}
            onChange={(event) =>
              onChange(
                updateEditableRecipeItem(items, item.key, {
                  unit: event.target.value,
                })
              )
            }
          />
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
            aria-label={`删除用料 ${index + 1}`}
            onClick={() => onChange(removeEditableRecipeItem(items, item.key))}
          >
            <RiCloseLine className="size-5" aria-hidden />
          </button>
        </li>
      ))}
      <li className="border-b border-border">
        <button
          type="button"
          className="flex h-11 w-full items-center px-1 text-sm font-medium text-primary-foreground"
          onClick={() => onChange(addEditableRecipeItem(items))}
        >
          加一样
        </button>
      </li>
    </ul>
  )
}
