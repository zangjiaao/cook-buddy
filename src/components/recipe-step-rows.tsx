import type { ReactNode } from "react"
import { RiArrowDownSLine, RiArrowUpSLine, RiCloseLine } from "@remixicon/react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  addEditableRecipeStep,
  moveEditableRecipeStep,
  removeEditableRecipeStep,
  updateEditableRecipeStep,
} from "@/lib/recipe-draft-items"
import type { EditableRecipeStep } from "@/lib/recipe-draft-items"

export function RecipeStepRows({
  steps,
  onChange,
}: {
  steps: EditableRecipeStep[]
  onChange: (steps: EditableRecipeStep[]) => void
}) {
  return (
    <ul className="border-t border-border">
      {steps.map((step, index) => (
        <li key={step.key} className="border-b border-border py-3">
          <div className="flex items-start gap-2">
            <span className="flex h-11 w-6 shrink-0 items-center justify-center text-sm text-muted-foreground">
              {index + 1}
            </span>
            <Textarea
              rows={2}
              className="min-h-20 min-w-0 flex-1 text-base leading-6 md:text-base"
              placeholder="这一步"
              aria-label={`步骤 ${index + 1}`}
              value={step.text}
              onChange={(event) =>
                onChange(
                  updateEditableRecipeStep(steps, step.key, {
                    text: event.target.value,
                  })
                )
              }
            />
            <div className="flex shrink-0">
              <IconAction
                label={`上移步骤 ${index + 1}`}
                disabled={index === 0}
                onClick={() =>
                  onChange(moveEditableRecipeStep(steps, index, -1))
                }
              >
                <RiArrowUpSLine className="size-5" aria-hidden />
              </IconAction>
              <IconAction
                label={`下移步骤 ${index + 1}`}
                disabled={index === steps.length - 1}
                onClick={() =>
                  onChange(moveEditableRecipeStep(steps, index, 1))
                }
              >
                <RiArrowDownSLine className="size-5" aria-hidden />
              </IconAction>
              <IconAction
                label={`删除步骤 ${index + 1}`}
                onClick={() =>
                  onChange(removeEditableRecipeStep(steps, step.key))
                }
              >
                <RiCloseLine className="size-5" aria-hidden />
              </IconAction>
            </div>
          </div>
          <div className="mt-2 pl-8">
            <Input
              className="h-11 text-base md:text-base"
              placeholder="小贴士，可空"
              aria-label={`步骤 ${index + 1} 小贴士`}
              value={step.tip}
              onChange={(event) =>
                onChange(
                  updateEditableRecipeStep(steps, step.key, {
                    tip: event.target.value,
                  })
                )
              }
            />
          </div>
        </li>
      ))}
      <li className="border-b border-border">
        <button
          type="button"
          className="flex h-11 w-full items-center px-1 text-sm font-medium text-primary-foreground"
          onClick={() => onChange(addEditableRecipeStep(steps))}
        >
          加一步
        </button>
      </li>
    </ul>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-30"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
