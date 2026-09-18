import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { RiSparkling2Fill } from "@remixicon/react"
import { useServerFn } from "@tanstack/react-start"
import { QuantityStepper } from "@/components/quantity-stepper"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { fieldControlClass } from "@/components/field"
import { generateMealPlanDraft } from "@/lib/ai/plan-draft.functions"
import { prettyDate } from "@/lib/dates"
import {
  DEFAULT_PLAN_DRAFT_PREFS,
  planDraftPrefsStorage,
  readPlanDraftPrefs,
  writePlanDraftPrefs,
} from "@/lib/plan-draft-prefs"
import type { PlanDraftPrefs } from "@/lib/plan-draft-prefs"
import { sortRecipesForList } from "@/lib/recipe-organize"
import {
  PLAN_DRAFT_DAY_PRESETS,
  PLAN_DRAFT_FILL_HINT,
  PLAN_DRAFT_FILL_STRATEGIES,
  PLAN_DRAFT_FILL_STRATEGY_LABEL,
  PLAN_DRAFT_PRIORITIES,
  PLAN_DRAFT_PRIORITY_LABEL,
  PLAN_DRAFT_REPLACE_HINT,
  addDraftDish,
  buildPlanDraftInput,
  buildPlanDraftWrites,
  fillDraftDay,
  heuristicPlanDraft,
  planDraftDishHint,
  planDraftHasProposals,
  planDraftRulesSummary,
  planDraftSourceLabel,
  planDraftWriteNeedsConfirm,
  removeDraftDish,
  replaceConfirmCopy,
  replaceDatesInDraft,
  setDraftDishServings,
  swapDraftDish,
  togglePlanDraftPriority,
} from "@/lib/plan-draft"
import type {
  PlanDraft,
  PlanDraftFillStrategy,
  PlanDraftPriority,
  PlanDraftRange,
  PlanDraftRecipe,
} from "@/lib/plan-draft"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"

type PanelMode = "setup" | "loading" | "review" | "confirm"

export function AiPlanHeaderButton() {
  return (
    <Button
      nativeButton={false}
      variant="ghost"
      className="h-11 w-11 text-primary"
      title="AI 排几天"
      render={<Link to="/plan/ai" />}
    >
      <RiSparkling2Fill className="size-6" aria-hidden />
      <span className="sr-only">AI 排几天</span>
    </Button>
  )
}

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
  const [mode, setMode] = useState<PanelMode>("setup")
  const [prefsReady, setPrefsReady] = useState(false)
  const [range, setRange] = useState<PlanDraftRange>(
    DEFAULT_PLAN_DRAFT_PREFS.range
  )
  const [dishesPerDay, setDishesPerDay] = useState(
    DEFAULT_PLAN_DRAFT_PREFS.dishesPerDay
  )
  const [fillStrategy, setFillStrategy] = useState<PlanDraftFillStrategy>(
    DEFAULT_PLAN_DRAFT_PREFS.fillStrategy
  )
  const [priorities, setPriorities] = useState<PlanDraftPriority[]>(
    DEFAULT_PLAN_DRAFT_PREFS.priorities
  )
  const [extraRequirements, setExtraRequirements] = useState(
    DEFAULT_PLAN_DRAFT_PREFS.extraRequirements
  )
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

  const prefs: PlanDraftPrefs = useMemo(
    () => ({
      range,
      dishesPerDay,
      fillStrategy,
      extraRequirements,
      priorities,
    }),
    [range, dishesPerDay, fillStrategy, extraRequirements, priorities]
  )

  useEffect(() => {
    const stored = readPlanDraftPrefs(planDraftPrefsStorage())
    setRange(stored.range)
    setDishesPerDay(stored.dishesPerDay)
    setFillStrategy(stored.fillStrategy)
    setExtraRequirements(stored.extraRequirements)
    setPriorities(stored.priorities)
    setPrefsReady(true)
  }, [])

  useEffect(() => {
    if (!prefsReady) return
    writePlanDraftPrefs(planDraftPrefsStorage(), prefs)
  }, [prefs, prefsReady])

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
        fillStrategy,
        dishesPerDay,
        extraRequirements,
        priorities,
      }),
    [
      today,
      range,
      horizonEnd,
      recipes,
      recipeItems,
      inventory,
      entries,
      fillStrategy,
      dishesPerDay,
      extraRequirements,
      priorities,
    ]
  )

  const catalogById = useMemo(
    () => new Map(draftInput.recipes.map((recipe) => [recipe.id, recipe])),
    [draftInput.recipes]
  )

  const rangeLabel =
    range.type === "horizon"
      ? `当前窗口（${prettyDate(horizonEnd, today)}止）`
      : `${range.days} 天`

  const ruleLines = planDraftRulesSummary({
    rangeLabel,
    dishesPerDay,
    fillStrategy,
    priorities,
    extraRequirements,
  })

  async function generate() {
    setMode("loading")
    setError("")
    setPicking(null)
    writePlanDraftPrefs(planDraftPrefsStorage(), prefs)
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
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-8">
      {mode === "setup" || mode === "loading" ? (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">排几天</h2>
            <div
              role="radiogroup"
              aria-label="排几天"
              className="flex flex-wrap gap-2"
            >
              <ChoiceChip
                selected={range.type === "horizon"}
                onClick={() => setRange({ type: "horizon" })}
              >
                当前窗口
              </ChoiceChip>
              {PLAN_DRAFT_DAY_PRESETS.map((days) => (
                <ChoiceChip
                  key={days}
                  selected={range.type === "days" && range.days === days}
                  onClick={() => setRange({ type: "days", days })}
                >
                  {`${days} 天`}
                </ChoiceChip>
              ))}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {rangeLabel}。从已有食谱里挑，不会新编菜。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">每天几道</h2>
            <div
              role="radiogroup"
              aria-label="每天几道"
              className="flex flex-wrap gap-2"
            >
              {[1, 2, 3, 4].map((count) => (
                <ChoiceChip
                  key={count}
                  selected={dishesPerDay === count}
                  onClick={() => setDishesPerDay(count)}
                >
                  {`${count} 道`}
                </ChoiceChip>
              ))}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              每天只排这么多道。例如每天只一道菜就选 1 道。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">怎么填</h2>
            <div
              role="radiogroup"
              aria-label="怎么填"
              className="flex flex-wrap gap-2"
            >
              {PLAN_DRAFT_FILL_STRATEGIES.map((strategy) => (
                <ChoiceChip
                  key={strategy}
                  selected={fillStrategy === strategy}
                  onClick={() => setFillStrategy(strategy)}
                >
                  {PLAN_DRAFT_FILL_STRATEGY_LABEL[strategy]}
                </ChoiceChip>
              ))}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {fillStrategy === "replace"
                ? PLAN_DRAFT_REPLACE_HINT
                : PLAN_DRAFT_FILL_HINT}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">固定优先级</h2>
            <div className="flex flex-wrap gap-2" aria-label="固定优先级">
              {PLAN_DRAFT_PRIORITIES.map((priority) => {
                const selected = priorities.includes(priority)
                return (
                  <button
                    key={priority}
                    type="button"
                    aria-pressed={selected}
                    className={
                      selected
                        ? "inline-flex h-11 min-w-14 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
                        : "inline-flex h-11 min-w-14 items-center justify-center rounded-full bg-muted px-4 text-sm font-medium text-muted-foreground"
                    }
                    onClick={() =>
                      setPriorities(
                        togglePlanDraftPriority(priorities, priority)
                      )
                    }
                  >
                    {PLAN_DRAFT_PRIORITY_LABEL[priority]}
                  </button>
                )
              })}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              默认都开：临期优先、常做优先、荤素汤主食搭配、少重复。关掉就不强化这条。
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">额外要求</h2>
            <Textarea
              className="min-h-24 text-base leading-7"
              value={extraRequirements}
              maxLength={200}
              placeholder="少吃辣、这周多汤…"
              aria-label="额外要求"
              onChange={(event) => setExtraRequirements(event.target.value)}
            />
            <p className="text-sm leading-6 text-muted-foreground">
              会传给 AI。规则草稿只做简单关键词，做不到不会新编菜。
            </p>
          </section>

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
        </>
      ) : null}

      {mode === "review" && draft ? (
        <DraftReview
          today={today}
          draft={draft}
          ruleLines={ruleLines}
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
    </div>
  )
}

function ChoiceChip({
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
  ruleLines,
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
  ruleLines: string[]
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
      {ruleLines.map((line) => (
        <p key={line} className="text-sm leading-6 text-muted-foreground">
          {line}
        </p>
      ))}
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
        返回改规则
      </Button>
    </>
  )
}
