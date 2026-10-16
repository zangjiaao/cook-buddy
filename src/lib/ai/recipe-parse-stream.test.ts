import { describe, expect, test } from "vitest"
import { readRecipeParseEvents } from "@/lib/ai/recipe-parse-stream"

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe("readRecipeParseEvents", () => {
  test("跨分片读出步骤和最终草稿", async () => {
    const statuses: string[] = []
    const outcome = await readRecipeParseEvents(
      streamOf([
        '{"type":"status","message":"正在搜索…"}\n{"type":"sta',
        'tus","message":"正在读取 recipes.example…"}\n',
        '{"type":"result","outcome":{"ok":true,"draft":{"name":"红烧肉","servings":2,"approxMinutes":90,"steps":["焖"],"items":[{"rawName":"五花肉","quantity":500,"unit":"克"}],"source":"ai","sourceUrl":"https://recipes.example/hongshaorou"}}}\n',
      ]),
      (message) => statuses.push(message)
    )
    expect(statuses).toEqual(["正在搜索…", "正在读取 recipes.example…"])
    expect(outcome).toMatchObject({
      ok: true,
      draft: {
        name: "红烧肉",
        sourceUrl: "https://recipes.example/hongshaorou",
      },
    })
  })
})
