import { useMemo, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { QuantityStepper } from "@/components/quantity-stepper"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fieldControlClass } from "@/components/field"
import { generateMealPlanDraft } from "@/lib/ai/plan-draft.functions"
import { prettyDate } from "@/lib/dates"
import { sortRecipesForList } from "@/lib/recipe-organize"
import {
  PLAN_DRAFT_DAY_PRESETS,
  PLAN_DRAFT_FILL_HINT,
  addDraftDish,
  buildPlanDraftInput,
  buildPlanDraftWrites,
  fillDraftDay,
  heuristicPlanDraft,
  planDraftDishHint,
  planDraftHasProposals,
  planDraftSourceLabel,
  planDraftWriteNeedsConfirm,
  removeDraftDish,
  replaceConfirmCopy,
  replaceDatesInDraft,
  setDraftDishServings,
  swapDraftDish,
} from "@/lib/plan-draft"
import type {
  PlanDraft,
  PlanDraftRange,
  PlanDraftRecipe,
} from "@/lib/plan-draft"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"

type PanelMode = "closed" | "setup" | "loading" | "review" | "confirm"

export function AiPlanDraftPanel({
  today,
  horizonEnd,
  recipes,
  recipeItems,
  inventory,
  entries,
  applying,
  onApply,
}: {
  today: string
  horizonEnd: string
  recipes: Recipe[]
  recipeItems: RecipeItem[]
  inventory: InventoryItem[]
  entries: PlanEntry[]
  applying?: boolean
  onApply: (write: ReturnType<typeof buildPlanDraftWrites>) => Promise<void>
}) {
  const generateOnServer = useServerFn(generateMealPlanDraft)
  const [mode, setMode] = useState<PanelMode>("closed")
  const [range, setRange] = useState<PlanDraftRange>({ type: "horizon" })
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [picking, setPicking] = useState<{
    date: string
    recipeId?: string
  } | null>(null)
  const [error, setError] = useState("")

  const pickerRecipes = useMemo(() => sortRecipesForList(recipes), [recipes])
  const recipeById = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.id, recipe])),
    [recipes]
  )

  const draftInput = useMemo(
    () =>
      buildPlanDraftInput({
        today,
        range,
        horizonEnd,
        recipes,
        recipeItems,
        inventory,
        entries,
        fillStrategy: "empty",
      }),
    [today, range, horizonEnd, recipes, recipeItems, inventory, entries]
  )

  const catalogById = useMemo(
    () => new Map(draftInput.recipes.map((recipe) => [recipe.id, recipe])),
    [draftInput.recipes]
  )

  function close() {
    setMode("closed")
    setDraft(null)
    setPicking(null)
    setError("")
  }

  async function generate() {
    setMode("loading")
    setError("")
    setPicking(null)
    try {
      try {
        setDraft(await generateOnServer({ data: draftInput }))
      } catch {
        setDraft(heuristicPlanDraft(draftInput))
      }
      setMode("review")
    } catch {
      setError("草稿没出来，再试一次。")
      setMode("setup")
    }
  }

  function updateDraft(next: PlanDraft) {
    setDraft(next)
    setPicking(null)
  }

  async function commit(confirmed: boolean) {
    if (!draft) return
    if (
      !confirmed &&
      planDraftWriteNeedsConfirm(draft, draftInput.occupiedDates)
    ) {
      setMode("confirm")
      return
    }
    const replaceDates = replaceDatesInDraft(draft, draftInput.occupiedDates)
    await onApply(
      buildPlanDraftWrites({
        existing: entries,
        draft,
        occupiedDates: draftInput.occupiedDates,
        replaceDates,
      })
    )
    close()
  }

  const rangeLabel =
    range.type === "horizon"
      ? `当前窗口（${prettyDate(horizonEnd, today)}止）`
      : `${range.days} 天`

  return (
    <Card>
      <CardContent className="space-y-3">
        {mode === "closed" ? (
          <>
            <Button
              variant="outline"
              className="h-12 w-full text-base"
              onClick={() => setMode("setup")}
            >
              AI 排几天
            </Button>
            <p className="text-sm leading-6 text-muted-foreground">
              机器先算一版，你改完再写入。{PLAN_DRAFT_FILL_HINT}
            </p>
          </>
        ) : null}

        {mode === "setup" || mode === "loading" ? (
          <>
            <p className="text-base font-medium">排几天</p>
            <div
              role="radiogroup"
              aria-label="排几天"
              className="flex flex-wrap gap-2"
            >
              <RangeChip
                selected={range.type === "horizon"}
                onClick={() => setRange({ type: "horizon" })}
              >
                当前窗口
              </RangeChip>
              {PLAN_DRAFT_DAY_PRESETS.map((days) => (
                <RangeChip
                  key={days}
                  selected={range.type === "days" && range.days === days}
                  onClick={() => setRange({ type: "days", days })}
                >
                  {days} 天
                </RangeChip>
              ))}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {rangeLabel}。优先消化临期库存，常做和荤素汤主食能配就配。
            </p>
            {error ? (
              <p className="text-sm leading-6 text-destructive">{error}</p>
            ) : null}
            <Button
              className="h-12 w-full text-base"
              disabled={mode === "loading" || recipes.length === 0}
              onClick={() => void generate()}
            >
              {mode === "loading" ? "正在出草稿…" : "出草稿"}
            </Button>
            {recipes.length === 0 ? (
              <p className="text-sm leading-6 text-muted-foreground">
                还没有食谱，先去加几道常做的。
              </p>
            ) : null}
            <Button variant="ghost" className="h-11 w-full" onClick={close}>
              取消
            </Button>
          </>
        ) : null}

        {mode === "review" && draft ? (
          <DraftReview
            today={today}
            draft={draft}
            catalogById={catalogById}
            recipeById={recipeById}
            pickerRecipes={pickerRecipes}
            picking={picking}
            applying={applying}
            soonIngredientIds={draftInput.soonIngredientIds}
            occupiedDates={draftInput.occupiedDates}
            onPicking={setPicking}
            onChange={updateDraft}
            onFillDay={(date) =>
              updateDraft(fillDraftDay(draft, date, draftInput))
            }
            onWrite={() => void commit(false)}
            onBack={() => {
              setMode("setup")
              setPicking(null)
            }}
          />
        ) : null}

        {mode === "confirm" && draft ? (
          <>
            <p className="text-base font-medium">要换掉已有的菜？</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {replaceConfirmCopy(
                replaceDatesInDraft(draft, draftInput.occupiedDates),
                today
              )}
            </p>
            <Button
              className="h-12 w-full text-base"
              disabled={applying}
              onClick={() => void commit(true)}
            >
              {applying ? "正在写入…" : "确认换掉还没做的"}
            </Button>
            <Button
              variant="ghost"
              className="h-11 w-full"
              disabled={applying}
              onClick={() => setMode("review")}
            >
              返回改草稿
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RangeChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={
        selected
          ? "inline-flex h-11 min-w-14 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
          : "inline-flex h-11 min-w-14 items-center justify-center rounded-full bg-muted px-4 text-sm font-medium text-muted-foreground"
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function DraftReview({
  today,
  draft,
  catalogById,
  recipeById,
  pickerRecipes,
  picking,
  applying,
  soonIngredientIds,
  occupiedDates,
  onPicking,
  onChange,
  onFillDay,
  onWrite,
  onBack,
}: {
  today: string
  draft: PlanDraft
  catalogById: Map<string, PlanDraftRecipe>
  recipeById: Map<string, Recipe>
  pickerRecipes: Recipe[]
  picking: { date: string; recipeId?: string } | null
  applying?: boolean
  soonIngredientIds: string[]
  occupiedDates: string[]
  onPicking: (next: { date: string; recipeId?: string } | null) => void
  onChange: (next: PlanDraft) => void
  onFillDay: (date: string) => void
  onWrite: () => void
  onBack: () => void
}) {
  const occupied = new Set(occupiedDates)
  const canWrite = planDraftHasProposals(draft)

  return (
    <>
      <p className="text-base font-medium">
        {planDraftSourceLabel(draft.source)}，先改再写入
      </p>
      {draft.notes.map((note) => (
        <p key={note} className="text-sm leading-6 text-muted-foreground">
          {note}
        </p>
      ))}
      {draft.days.map((day) => {
        const skipped =
          day.skippedReason === "occupied" && day.dishes.length === 0
        return (
          <section key={day.date} className="space-y-2">
            <h3 className="text-base font-medium">
              {prettyDate(day.date, today)}
            </h3>
            {skipped ? (
              <p className="text-sm leading-6 text-muted-foreground">
                已有菜，先不动。
              </p>
            ) : null}
            {day.dishes.map((dish) => {
              const catalog = catalogById.get(dish.recipeId)
              const recipe = recipeById.get(dish.recipeId)
              const hint = planDraftDishHint(dish, catalog)
              const swapping =
                picking?.date === day.date && picking.recipeId === dish.recipeId
              return (
                <div
                  key={`${day.date}-${dish.recipeId}`}
                  className="space-y-2 rounded-md bg-muted/60 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-medium">
                        {recipe?.name ?? catalog?.name ?? "未知菜"}
                      </p>
                      {hint ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {hint}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      className="h-10"
                      onClick={() =>
                        onChange(
                          removeDraftDish(draft, day.date, dish.recipeId)
                        )
                      }
                    >
                      去掉
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">份数</span>
                    <QuantityStepper
                      value={dish.servings}
                      onChange={(value) =>
                        onChange(
                          setDraftDishServings(
                            draft,
                            day.date,
                            dish.recipeId,
                            value
                          )
                        )
                      }
                    />
                  </div>
                  {swapping ? (
                    <select
                      className={fieldControlClass}
                      defaultValue=""
                      onChange={(event) => {
                        const nextId = event.target.value
                        const next = catalogById.get(nextId)
                        if (next) {
                          onChange(
                            swapDraftDish(
                              draft,
                              day.date,
                              dish.recipeId,
                              next,
                              soonIngredientIds
                            )
                          )
                        }
                      }}
                    >
                      <option value="">换成另一道</option>
                      {pickerRecipes
                        .filter((item) => item.id !== dish.recipeId)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.favorited ? `常做 · ${item.name}` : item.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-11 w-full text-base"
                      onClick={() =>
                        onPicking({ date: day.date, recipeId: dish.recipeId })
                      }
                    >
                      换一道
                    </Button>
                  )}
                </div>
              )
            })}
            {picking?.date === day.date && !picking.recipeId ? (
              <select
                className={fieldControlClass}
                defaultValue=""
                onChange={(event) => {
                  const next = catalogById.get(event.target.value)
                  if (next) {
                    onChange(
                      addDraftDish(draft, day.date, next, soonIngredientIds)
                    )
                  }
                }}
              >
                <option value="">选一道菜</option>
                {pickerRecipes
                  .filter(
                    (item) =>
                      !day.dishes.some((dish) => dish.recipeId === item.id)
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.favorited ? `常做 · ${item.name}` : item.name}
                    </option>
                  ))}
              </select>
            ) : skipped ? (
              <Button
                variant="outline"
                className="h-11 w-full text-base"
                onClick={() => onFillDay(day.date)}
              >
                也排这天
              </Button>
            ) : (
              <Button
                variant="outline"
                className="h-11 w-full text-base"
                onClick={() => onPicking({ date: day.date })}
              >
                加一道
              </Button>
            )}
            {occupied.has(day.date) && day.dishes.length > 0 ? (
              <p className="text-sm leading-6 text-muted-foreground">
                这天已有菜，写入前会再问你要不要换掉还没做的。
              </p>
            ) : null}
          </section>
        )
      })}
      <Button
        className="h-12 w-full text-base"
        disabled={!canWrite || applying}
        onClick={onWrite}
      >
        {applying ? "正在写入…" : "写入计划"}
      </Button>
      <Button
        variant="ghost"
        className="h-11 w-full"
        disabled={applying}
        onClick={onBack}
      >
        返回重选天数
      </Button>
    </>
  )
}
