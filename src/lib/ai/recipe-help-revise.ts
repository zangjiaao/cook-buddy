import { extractJsonObject } from "@/lib/ai/parse-recipe"
import { parseHelpProposal } from "@/lib/recipe-help"
import type {
  HelpNote,
  HelpProposal,
  RecipeHelpSnapshot,
} from "@/lib/recipe-help"

export const HELP_REVISE_SYSTEM_PROMPT = `你是中文家常菜谱的修改整理员。根据现有菜谱和别人的原话，输出修改后的完整菜谱 JSON。不要解释。

JSON 形状：
{
  "ingredients": [{"id":"meat","rawName":"五花肉","quantity":400,"unit":"克"}],
  "steps": [{"id":"s1","text":"冷水下锅焯水","tip":"冷水下锅"}]
}

规则：
- 输出修改后的完整食材和步骤，不是差异列表
- 保留的食材和步骤必须沿用原来的 id
- 新增食材 id 用 n1、n2，新增步骤 id 用 t1、t2，只用英文字母、数字、下划线和减号
- 删掉的不要出现
- 数组顺序就是新的顺序
- tip 是这一步的小贴士，没有就用空字符串
- quantity 是数字，unit 用个、克、片、勺这类短单位
- 只改原话提到的地方，其余保持原样
- 针对某一步的意见只改那一步
- 不要改菜名和份数，也不要输出它们`

export function buildHelpReviseUserPayload(
  snapshot: RecipeHelpSnapshot,
  note: HelpNote
): string {
  return JSON.stringify({
    recipe: {
      name: snapshot.name,
      servings: snapshot.servings,
      ingredients: snapshot.ingredients,
      steps: snapshot.steps,
    },
    comment: note.comment,
    stepNotes: note.stepNotes,
  })
}

export function parseHelpReviseContent(
  text: string,
  snapshot: RecipeHelpSnapshot
): HelpProposal | null {
  try {
    const parsed = parseHelpProposal(extractJsonObject(text), snapshot)
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}
