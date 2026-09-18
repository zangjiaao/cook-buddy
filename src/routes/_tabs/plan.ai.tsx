import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { AiPlanDraftPanel } from "@/components/ai-plan-draft-panel"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { useDb, useQuery } from "@/hooks/use-db"
import { formatISODate } from "@/lib/dates"
import {
  applyMealPlanDraft,
  inventoryRepo,
  planRepo,
  recipeItemsRepo,
  recipesRepo,
} from "@/lib/db/repos"
import type { PlanDraftWrite } from "@/lib/plan-draft"
import {
  planHorizonStorage,
  readHorizonEnd,
  resolvePlanHorizon,
} from "@/lib/plan-horizon"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/plan/ai")({
  component: PlanAiPage,
})

function PlanAiPage() {
  const navigate = useNavigate()
  const { refresh } = useDb()
  const today = formatISODate()
  const [preferredEnd, setPreferredEnd] = useState<string | null>(null)
  const [applyingDraft, setApplyingDraft] = useState(false)
  const { data: entries } = useQuery(
    "plan",
    () => planRepo.list(),
    [] as PlanEntry[]
  )
  const { data: recipes } = useQuery(
    "recipes",
    () => recipesRepo.list(),
    [] as Recipe[]
  )
  const { data: recipeItems } = useQuery(
    "recipe-items",
    () => recipeItemsRepo.list(),
    [] as RecipeItem[]
  )
  const { data: inventory } = useQuery(
    "inventory",
    () => inventoryRepo.list(),
    [] as InventoryItem[]
  )

  useEffect(() => {
    const storage = planHorizonStorage()
    if (storage) setPreferredEnd(readHorizonEnd(storage))
  }, [])

  const entryDates = useMemo(
    () => entries.map((entry) => entry.date),
    [entries]
  )
  const horizon = useMemo(
    () => resolvePlanHorizon({ today, preferredEnd, entryDates }),
    [today, preferredEnd, entryDates]
  )

  async function applyDraft(write: PlanDraftWrite) {
    setApplyingDraft(true)
    try {
      await applyMealPlanDraft(write)
      refresh()
      void navigate({ to: "/plan" })
    } finally {
      setApplyingDraft(false)
    }
  }

  return (
    <>
      <PageHeader
        title="AI 排几天"
        subtitle="先看规则，改完再出草稿。写入前你会再确认。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/plan" />}
          >
            返回
          </Button>
        }
      />
      <AiPlanDraftPanel
        today={today}
        horizonEnd={horizon.end}
        recipes={recipes}
        recipeItems={recipeItems}
        inventory={inventory}
        entries={entries}
        applying={applyingDraft}
        onApply={applyDraft}
      />
    </>
  )
}
