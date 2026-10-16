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
        <div className="border-b border-border py-2">
          <ServingsField value={servings} onChange={onServingsChange} />
        </div>
        <div className="border-b border-border py-2">
          <MinutesField value={minutes} onChange={onMinutesChange} />
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

function ServingsField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const current = parseServings(value)
  return (
    <div className="flex items-center gap-2">
      <FieldLabel>份数</FieldLabel>
      <StepButton
        label="减少份数"
        disabled={current <= SERVINGS_MIN}
        onClick={() => onChange(formatServings(current - 1))}
      >
        −
      </StepButton>
      <SuffixBox suffix="人份">
        <input
          className={suffixInputClass}
          inputMode="numeric"
          aria-label="份数"
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, 2))
          }
          onBlur={() => onChange(formatServings(parseServings(value)))}
        />
      </SuffixBox>
      <StepButton
        label="增加份数"
        disabled={current >= SERVINGS_MAX}
        onClick={() => onChange(formatServings(current + 1))}
      >
        +
      </StepButton>
    </div>
  )
}

function MinutesField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel>用时</FieldLabel>
      <SuffixBox suffix="分钟">
        <input
          className={suffixInputClass}
          inputMode="numeric"
          aria-label="用时"
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, 3))
          }
        />
      </SuffixBox>
    </div>
  )
}

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="w-10 shrink-0 text-sm text-muted-foreground">
      {children}
    </span>
  )
}

function SuffixBox({
  suffix,
  children,
}: {
  suffix: string
  children: ReactNode
}) {
  return (
    <div className="flex h-11 min-w-0 flex-1 items-center rounded-md border border-input bg-input/20 pr-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30">
      {children}
      <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-base disabled:opacity-30"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const SERVINGS_MIN = 1
const SERVINGS_MAX = 99

const suffixInputClass =
  "h-11 min-w-0 flex-1 bg-transparent px-3 text-base outline-none md:text-base"

function parseServings(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return SERVINGS_MIN
  return parsed
}

function formatServings(value: number): string {
  return String(Math.min(SERVINGS_MAX, Math.max(SERVINGS_MIN, value)))
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
