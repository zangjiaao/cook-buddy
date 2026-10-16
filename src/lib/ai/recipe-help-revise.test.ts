import { describe, expect, test } from "vitest"
import { parseHelpReviseContent } from "@/lib/ai/recipe-help-revise"
import { reviseHelpWithAi } from "@/lib/ai/recipe-help-revise.server"
import type { HelpNote, RecipeHelpSnapshot } from "@/lib/recipe-help"

const snapshot: RecipeHelpSnapshot = {
  name: "红烧肉",
  servings: 2,
  ingredients: [{ id: "meat", rawName: "五花肉", quantity: 500, unit: "克" }],
  steps: [{ id: "s1", text: "焯水", tip: "" }],
}

const note: HelpNote = {
  author: "妈妈",
  comment: "五花肉改成 400 克",
  stepNotes: [],
}

const proposal = {
  ingredients: [{ id: "meat", rawName: "五花肉", quantity: 400, unit: "克" }],
  steps: snapshot.steps,
}

function completion(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("帮改原话整理", () => {
  test("没有 key 时不编造改动", async () => {
    let called = false
    const result = await reviseHelpWithAi(snapshot, note, {
      env: {},
      fetchFn: async () => {
        called = true
        return completion("{}")
      },
    })
    expect(result).toBeNull()
    expect(called).toBe(false)
  })

  test("校验通过才收下模型输出", async () => {
    const result = await reviseHelpWithAi(snapshot, note, {
      env: { DEEPSEEK_API_KEY: "test-key" },
      fetchFn: async () => completion(JSON.stringify(proposal)),
    })
    expect(result).toEqual(proposal)
  })

  test("坏 JSON、空改动和接口失败都当作没整理出来", async () => {
    const options = { env: { DEEPSEEK_API_KEY: "test-key" } }
    expect(
      await reviseHelpWithAi(snapshot, note, {
        ...options,
        fetchFn: async () => completion("不是 json"),
      })
    ).toBeNull()
    expect(
      await reviseHelpWithAi(snapshot, note, {
        ...options,
        fetchFn: async () =>
          completion(
            JSON.stringify({
              ingredients: snapshot.ingredients,
              steps: snapshot.steps,
            })
          ),
      })
    ).toBeNull()
    expect(
      await reviseHelpWithAi(snapshot, note, {
        ...options,
        fetchFn: async () => completion("nope", 500),
      })
    ).toBeNull()
    expect(
      parseHelpReviseContent(
        '```json\n{"ingredients":[{"id":"meat","rawName":"五花肉","quantity":400,"unit":"克"}],"steps":[{"id":"s1","text":"焯水","tip":""}]}\n```',
        snapshot
      )
    ).toEqual(proposal)
  })
})
