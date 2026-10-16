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
    <div>
      <div
        className="flex items-center gap-2 border-t border-b border-border py-1.5"
        aria-hidden="true"
      >
        <span className="min-w-0 flex-1 px-2 text-xs text-muted-foreground">
          名称
        </span>
        <span className="w-16 shrink-0 px-2 text-xs text-muted-foreground">
          数量
        </span>
        <span className="w-16 shrink-0 px-2 text-xs text-muted-foreground">
          单位
        </span>
        <span className="w-11 shrink-0" />
      </div>
      <ul>
        {items.map((item, index) => (
          <li
            key={item.key}
            className="flex items-center gap-2 border-b border-border py-2"
          >
            <Input
              className="h-11 min-w-0 flex-1 text-base md:text-base"
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
              className="h-11 w-16 shrink-0 text-base md:text-base"
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
              className="h-11 w-16 shrink-0 text-base md:text-base"
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
              onClick={() =>
                onChange(removeEditableRecipeItem(items, item.key))
              }
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
    </div>
  )
}
