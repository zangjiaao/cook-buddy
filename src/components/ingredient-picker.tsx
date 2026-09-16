import { useEffect, useMemo, useState } from "react"
import { Field, fieldControlClass } from "@/components/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  closeMatchesForCreate,
  searchIngredients,
} from "@/lib/ai/match-ingredient"
import type { RankedIngredient } from "@/lib/ai/match-ingredient"
import { CATEGORY_SHELF_LIFE_DAYS } from "@/lib/shelf-life"
import { categoryLabel, MARKET_UNITS, matchStatusLabel } from "@/lib/labels"
import { CATEGORIES } from "@/lib/types"
import type { Category, Ingredient } from "@/lib/types"

export type NewIngredientDraft = {
  name: string
  category: Category
  defaultUnit: string
}

type Phase = "search" | "confirm" | "create"

export function IngredientPicker({
  ingredients,
  valueId,
  allowCreate = false,
  compact = false,
  initialQuery = "",
  onSelect,
  onCreate,
}: {
  ingredients: Ingredient[]
  valueId: string
  allowCreate?: boolean
  compact?: boolean
  initialQuery?: string
  onSelect: (ingredient: Ingredient, typedName: string) => void
  onCreate?: (draft: NewIngredientDraft) => Promise<Ingredient>
}) {
  const selected = ingredients.find((ingredient) => ingredient.id === valueId)
  const [query, setQuery] = useState(selected?.name ?? initialQuery)

  useEffect(() => {
    if (selected) setQuery(selected.name)
  }, [selected])
  const [phase, setPhase] = useState<Phase>("search")
  const [creating, setCreating] = useState(false)
  const [category, setCategory] = useState<Category>("veg")
  const [defaultUnit, setDefaultUnit] = useState("把")
  const [error, setError] = useState("")

  const results = useMemo(
    () => searchIngredients(query, ingredients, compact ? 5 : 8),
    [compact, ingredients, query]
  )
  const closeMatches = useMemo(
    () => closeMatchesForCreate(query, ingredients),
    [ingredients, query]
  )

  function pick(ingredient: Ingredient) {
    setQuery(ingredient.name)
    setPhase("search")
    setError("")
    onSelect(ingredient, query.trim() || ingredient.name)
  }

  function startCreate() {
    const name = query.trim()
    if (!name) {
      setError("先写食材名")
      return
    }
    if (closeMatches.length > 0) {
      setPhase("confirm")
      setError("")
      return
    }
    setCategory("veg")
    setDefaultUnit("把")
    setPhase("create")
    setError("")
  }

  async function confirmCreate() {
    if (!onCreate) return
    const name = query.trim()
    if (!name) return
    setCreating(true)
    setError("")
    try {
      const created = await onCreate({ name, category, defaultUnit })
      setQuery(created.name)
      setPhase("search")
      onSelect(created, name)
    } catch (createError) {
      console.error("新建食材失败", createError)
      setError("新建失败，请再试一次。")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field label={compact ? "对齐到" : "食材"}>
        <Input
          className="h-12 text-base"
          placeholder="搜已有的，或输入新名字"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPhase("search")
            setError("")
          }}
        />
      </Field>
      {selected ? (
        <p className="text-sm leading-6 text-muted-foreground">
          已对齐：{selected.name}
          {selected.aliases.length > 0
            ? ` · 也叫 ${selected.aliases.join("、")}`
            : ""}
        </p>
      ) : null}
      {phase === "confirm" ? (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm leading-6">
            「{query.trim()}」和已有食材很像。先点「就是这个」，避免清单对不上。
          </p>
          {closeMatches.map((row) => (
            <MatchRow key={row.ingredient.id} row={row} onPick={pick} />
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full text-sm"
            onClick={() => {
              setCategory("veg")
              setDefaultUnit("把")
              setPhase("create")
            }}
          >
            仍要新建「{query.trim()}」
          </Button>
        </div>
      ) : null}
      {phase === "create" ? (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm leading-6">
            新建「{query.trim()}」。叶菜默认冷藏约{" "}
            {CATEGORY_SHELF_LIFE_DAYS.veg} 天，可在过期日改。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="分类">
              <select
                className={fieldControlClass}
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as Category)
                }
              >
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabel[item]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="默认单位">
              <select
                className={fieldControlClass}
                value={defaultUnit}
                onChange={(event) => setDefaultUnit(event.target.value)}
              >
                {[defaultUnit, ...MARKET_UNITS]
                  .filter((unit, index, all) => all.indexOf(unit) === index)
                  .map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Button
            type="button"
            className="h-11 w-full text-base"
            disabled={creating}
            onClick={() => void confirmCreate()}
          >
            {creating ? "正在新建…" : "确认新建"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full"
            disabled={creating}
            onClick={() => setPhase("search")}
          >
            返回
          </Button>
        </div>
      ) : null}
      {phase === "search" ? (
        <div className="space-y-2">
          {results.map((row) => (
            <MatchRow
              key={row.ingredient.id}
              row={row}
              selected={row.ingredient.id === valueId}
              onPick={pick}
            />
          ))}
          {allowCreate && !selected ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full text-sm"
              onClick={startCreate}
            >
              没有，新建这个食材
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="text-sm leading-6 text-destructive">{error}</p>
      ) : null}
    </div>
  )
}

function MatchRow({
  row,
  selected = false,
  onPick,
}: {
  row: RankedIngredient
  selected?: boolean
  onPick: (ingredient: Ingredient) => void
}) {
  const aliases = row.ingredient.aliases
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{row.ingredient.name}</p>
        <p className="text-xs leading-5 text-muted-foreground">
          {categoryLabel[row.ingredient.category]}
          {aliases.length > 0 ? ` · ${aliases.join("、")}` : ""}
          {row.score > 0 ? ` · ${matchStatusLabel[row.matchStatus]}` : ""}
          {selected ? " · 当前" : ""}
        </p>
      </div>
      <Button
        type="button"
        variant={selected ? "secondary" : "default"}
        className="h-10 shrink-0 px-3 text-sm"
        onClick={() => onPick(row.ingredient)}
      >
        就是这个
      </Button>
    </div>
  )
}
