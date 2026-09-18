import { isAiEnabled, requestDeepSeekJson } from "@/lib/ai/deepseek"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"
import {
  heuristicPlanDraft,
  mergeAiPlanDraft,
  PLAN_DRAFT_PRIORITY_LABEL,
  sanitizeExtraRequirements,
  sanitizePlanDraftPriorities,
  tryParsePlanDraftJson,
} from "@/lib/plan-draft"
import type { PlanDraft, PlanDraftInput } from "@/lib/plan-draft"

export type PlanDraftAiOptions = DeepSeekRequestOptions

export const PLAN_DRAFT_SYSTEM_PROMPT = `你是中文家常一周排菜单草稿助手。只从用户给出的已有食谱 id 里挑菜，按天组成草稿。必须输出一个 JSON 对象，不要解释，不要发明食谱。

JSON 形状：
{
  "days": [
    { "date": "2026-09-18", "recipeIds": ["rec-stirfry", "rec-soup"] }
  ]
}

规则：
- date 必须是用户给的日期；recipeIds 必须是用户给的食谱 id
- 不要编造食谱、食材或 id。没有合适的菜就让那天 recipeIds 为空
- fillStrategy 为 empty 时，occupiedDates 里的日子不要排菜
- 优先：用掉临期食材（soonIngredientIds）的菜排到靠前的日子
- 其次：favorited 常做食谱
- 同一天尽量荤素/汤羹/主食搭配（tags: hun / su / tang / zhushi），能配则配
- 每天大约 dishesPerDay 道，不要超过 4 道
- priorities 是用户打开的固定优先级；没打开的不要特意强化
- extraRequirements 是用户补充的一句话，尽量照顾；做不到就忽略
- 人会再改再确认，你只出草稿`

export function buildPlanDraftSystemPrompt(input: PlanDraftInput): string {
  const lines = [PLAN_DRAFT_SYSTEM_PROMPT]
  const priorities = sanitizePlanDraftPriorities(input.priorities)
  const labels = priorities.map((item) => PLAN_DRAFT_PRIORITY_LABEL[item])
  lines.push(
    labels.length > 0
      ? `用户打开的优先级：${labels.join("、")}。没打开的不要特意强化。`
      : "用户关掉了全部固定优先级，按天数和每天道数匀一下即可。"
  )
  const extra = sanitizeExtraRequirements(input.extraRequirements)
  if (extra) {
    lines.push(
      `用户补充要求（只从已有食谱里挑，不要发明菜；照顾不到就忽略）：${extra}`
    )
  }
  return lines.join("\n")
}

export function buildPlanDraftUserPayload(input: PlanDraftInput): string {
  const extra = sanitizeExtraRequirements(input.extraRequirements)
  return JSON.stringify({
    days: input.days,
    fillStrategy: input.fillStrategy,
    occupiedDates: input.occupiedDates,
    soonIngredientIds: input.soonIngredientIds,
    dishesPerDay: input.dishesPerDay ?? 2,
    priorities: sanitizePlanDraftPriorities(input.priorities),
    extraRequirements: extra || undefined,
    recipes: input.recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      favorited: recipe.favorited,
      tags: recipe.tags,
      ingredientIds: recipe.ingredientIds,
    })),
  })
}

export async function generatePlanDraftWithAi(
  input: PlanDraftInput,
  options: PlanDraftAiOptions = {}
): Promise<PlanDraft> {
  const fallback = heuristicPlanDraft(input)
  if (!isAiEnabled(options.env)) return fallback

  try {
    const content = await requestDeepSeekJson(
      buildPlanDraftSystemPrompt(input),
      buildPlanDraftUserPayload(input),
      {
        ...options,
        temperature: options.temperature ?? 0.3,
      }
    )
    const aiDays = tryParsePlanDraftJson(content, input)
    if (aiDays) return mergeAiPlanDraft(aiDays, input, fallback)
  } catch {
    // missing key already handled; timeout / HTTP / bad JSON → heuristic
  }

  return fallback
}
