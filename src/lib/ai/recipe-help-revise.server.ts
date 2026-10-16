import { isAiEnabled, requestDeepSeekJson } from "@/lib/ai/deepseek"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"
import {
  HELP_REVISE_SYSTEM_PROMPT,
  buildHelpReviseUserPayload,
  parseHelpReviseContent,
} from "@/lib/ai/recipe-help-revise"
import type {
  HelpNote,
  HelpProposal,
  RecipeHelpSnapshot,
} from "@/lib/recipe-help"

export async function reviseHelpWithAi(
  snapshot: RecipeHelpSnapshot,
  note: HelpNote,
  options: DeepSeekRequestOptions = {}
): Promise<HelpProposal | null> {
  if (!isAiEnabled(options.env)) return null
  try {
    const content = await requestDeepSeekJson(
      HELP_REVISE_SYSTEM_PROMPT,
      buildHelpReviseUserPayload(snapshot, note),
      { ...options, temperature: 0 }
    )
    return parseHelpReviseContent(content, snapshot)
  } catch {
    return null
  }
}
