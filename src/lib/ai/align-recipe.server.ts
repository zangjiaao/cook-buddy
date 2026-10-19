import {
  alignInputFromPayload,
  alignUserPrompt,
  ALIGN_SYSTEM_PROMPT,
  mergeAiAlignments,
  parseAlignModelJson,
  type AlignRecipePayload,
} from "@/lib/ai/align-recipe"
import {
  isAiEnabled,
  requestDeepSeekJson,
  type DeepSeekRequestOptions,
} from "@/lib/ai/deepseek"
import { alignRecipeLines, type AlignResultLine } from "@/lib/recipe-align"

export async function alignRecipeWithAi(
  payload: AlignRecipePayload,
  options: DeepSeekRequestOptions = {}
): Promise<AlignResultLine[]> {
  const input = alignInputFromPayload(payload)
  const local = alignRecipeLines(input)
  if (!local.some((line) => line.needsAi) || !isAiEnabled(options.env)) {
    return local
  }
  const pending = local.filter((line) => line.needsAi)
  try {
    const content = await requestDeepSeekJson(
      ALIGN_SYSTEM_PROMPT,
      alignUserPrompt({ ...payload, lines: pending }),
      options
    )
    const parsed = parseAlignModelJson(content)
    if (!parsed) return local
    return mergeAiAlignments(local, parsed, input)
  } catch {
    return local
  }
}
