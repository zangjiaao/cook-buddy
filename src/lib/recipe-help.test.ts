import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { applyMigrationFiles, createMemoryD1 } from "@/lib/db/memory-d1"
import {
  HELP_MAX_OPEN_LINKS,
  HELP_MAX_SUBMISSIONS,
  HELP_ORDER_CHANGE_ID,
  applyAcceptedHelp,
  createShareToken,
  formatHelpIngredient,
  helpChanges,
  helpExpiresAt,
  helpReturnPath,
  ingredientChangeId,
  isHelpToken,
  parseHelpNote,
  parseHelpProposal,
  planRecipeItemWrites,
  shareSourceLabel,
  snapshotFromRecipe,
  stepChangeId,
  suggestionsOpen,
  tipChangeId,
} from "@/lib/recipe-help"
import type {
  HelpIngredient,
  HelpStep,
  RecipeHelpSnapshot,
} from "@/lib/recipe-help"
import {
  claimRecipeShareSave,
  closeRecipeShareLink,
  countPendingSuggestions,
  createRecipeShareLink,
  listPendingSuggestionCounts,
  listRecipeShareLinks,
  listRecipeSuggestions,
  readPublicRecipeHelp,
  reorganizeRecipeSuggestion,
  resolveRecipeSuggestion,
  submitRecipeHelp,
  submitSelfRecipeHelp,
} from "@/lib/recipe-help-store"
import type { Recipe, RecipeItem } from "@/lib/types"

const migrations = [
  resolve("migrations/0001_better_auth.sql"),
  resolve("migrations/0002_user_records.sql"),
  resolve("migrations/0003_recipe_help.sql"),
]

const NOW = "2026-10-01T00:00:00.000Z"
const TOKEN = "abcdefghij1234567890ABCD"

function ingredient(
  id: string,
  rawName: string,
  quantity: number,
  unit: string
): HelpIngredient {
  return { id, rawName, quantity, unit }
}

function step(id: string, text: string, tip = ""): HelpStep {
  return { id, text, tip }
}

function baseSnapshot(
  ingredients: HelpIngredient[],
  steps: HelpStep[]
): RecipeHelpSnapshot {
  return { name: "红烧肉", servings: 2, ingredients, steps }
}

function recipeItem(
  partial: Pick<RecipeItem, "id" | "rawName" | "quantity" | "unit"> &
    Partial<RecipeItem>
): RecipeItem {
  return {
    recipeId: "rec-1",
    ingredientId: "ing-1",
    matchStatus: "linked",
    ...partial,
  }
}

describe("帮改快照和校验", () => {
  test("token 足够长，默认 7 天后失效", () => {
    const token = createShareToken()
    expect(isHelpToken(token)).toBe(true)
    expect(token).toHaveLength(24)
    expect(helpExpiresAt(NOW)).toBe("2026-10-08T00:00:00.000Z")
    expect(shareSourceLabel("测试")).toBe("来自测试的分享")
    expect(shareSourceLabel("  ")).toBe("来自分享")
    expect(
      suggestionsOpen(
        {
          allowSuggestions: true,
          helpExpiresAt: "2026-10-08T00:00:00.000Z",
          closedAt: null,
        },
        "2026-10-07T00:00:00.000Z"
      )
    ).toBe(true)
    expect(
      suggestionsOpen(
        {
          allowSuggestions: true,
          helpExpiresAt: "2026-10-08T00:00:00.000Z",
          closedAt: null,
        },
        "2026-10-08T00:00:00.000Z"
      )
    ).toBe(false)
    expect(helpReturnPath(`/help/${TOKEN}`)).toBe(`/help/${TOKEN}`)
    expect(helpReturnPath("https://example.com/help/" + TOKEN)).toBeNull()
    expect(helpReturnPath("/recipes")).toBeNull()
  })

  test("从本地菜谱做出快照，贴士跟步骤对齐", () => {
    const recipe: Recipe = {
      id: "rec-1",
      name: " 红烧肉 ",
      servings: 3,
      approxMinutes: 40,
      steps: ["焯水", "炒糖色"],
      stepTips: ["冷水下锅", ""],
      createdAt: NOW,
      updatedAt: NOW,
    }
    const parsed = snapshotFromRecipe(recipe, [
      recipeItem({ id: "ri-1", rawName: "五花肉", quantity: 500, unit: "克" }),
    ])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.name).toBe("红烧肉")
    expect(parsed.value.steps[0]).toEqual({
      id: "s1",
      text: "焯水",
      tip: "冷水下锅",
    })
    expect(parsed.value.ingredients[0].rawName).toBe("五花肉")
  })

  test("原话要有署名，并且至少写一句", () => {
    const snapshot = baseSnapshot(
      [ingredient("a", "五花肉", 500, "克")],
      [step("s1", "焯水")]
    )
    expect(
      parseHelpNote({ author: "  ", comment: "少放糖" }, snapshot).ok
    ).toBe(false)
    expect(
      parseHelpNote({ author: "妈妈", comment: "", stepNotes: [] }, snapshot)
    ).toMatchObject({ ok: false, reason: "写下想改的地方。" })
    expect(
      parseHelpNote({ author: "妈妈", comment: "糖".repeat(501) }, snapshot)
    ).toMatchObject({ ok: false })
    expect(
      parseHelpNote(
        {
          author: "妈妈",
          comment: "",
          stepNotes: [{ stepId: "missing", text: "冷水下锅" }],
        },
        snapshot
      )
    ).toMatchObject({ ok: false, reason: "这一步不在菜谱里。" })
    const note = parseHelpNote(
      {
        author: " 妈妈 ",
        comment: "",
        stepNotes: [{ stepId: "s1", text: " 冷水下锅 " }],
      },
      snapshot
    )
    expect(note).toEqual({
      ok: true,
      value: {
        author: "妈妈",
        comment: "",
        stepNotes: [{ stepId: "s1", text: "冷水下锅" }],
      },
    })
  })

  test("整理结果要能对上快照，空改动不算数", () => {
    const snapshot = baseSnapshot(
      [ingredient("a", "五花肉", 500, "克")],
      [step("s1", "焯水")]
    )
    expect(
      parseHelpProposal(
        {
          ingredients: snapshot.ingredients,
          steps: [step("s1", "焯".repeat(201))],
        },
        snapshot
      )
    ).toMatchObject({ ok: false })
    expect(
      parseHelpProposal(
        {
          ingredients: Array.from({ length: 41 }, (_, index) =>
            ingredient(`n${index}`, "姜", 1, "片")
          ),
          steps: snapshot.steps,
        },
        snapshot
      )
    ).toMatchObject({ ok: false })
    expect(
      parseHelpProposal(
        { ingredients: snapshot.ingredients, steps: snapshot.steps },
        snapshot
      )
    ).toMatchObject({ ok: false, reason: "没整理出改动。" })
    expect(
      parseHelpProposal(
        {
          ingredients: [ingredient("a", "五花肉", 400, "克")],
          steps: snapshot.steps,
        },
        snapshot
      ).ok
    ).toBe(true)
  })
})

describe("帮改对比和部分接受", () => {
  const snapshot = baseSnapshot(
    [
      ingredient("meat", "五花肉", 500, "克"),
      ingredient("sugar", "冰糖", 20, "克"),
    ],
    [step("s1", "焯水"), step("s2", "炒糖色"), step("s3", "收汁")]
  )

  test("食材和步骤的增删改、贴士、顺序都能列出来", () => {
    const changes = helpChanges(snapshot, {
      ingredients: [
        ingredient("meat", "五花肉", 400, "克"),
        ingredient("ginger", "姜", 3, "片"),
      ],
      steps: [
        step("s2", "炒糖色", "小火"),
        step("s1", "冷水下锅焯水"),
        step("s4", "焖四十分钟", "中途翻一次"),
      ],
    })
    expect(changes.map((change) => change.id)).toEqual([
      ingredientChangeId("change", "meat"),
      ingredientChangeId("remove", "sugar"),
      ingredientChangeId("add", "ginger"),
      stepChangeId("change", "s1"),
      tipChangeId("add", "s2"),
      stepChangeId("remove", "s3"),
      stepChangeId("add", "s4"),
      HELP_ORDER_CHANGE_ID,
    ])
    expect(
      changes.find(
        (change) => change.id === ingredientChangeId("add", "ginger")
      )
    ).toMatchObject({
      kind: "add",
      after: formatHelpIngredient(ingredient("ginger", "姜", 3, "片")),
    })
  })

  test("只接受数量修改，不加新食材也不删", () => {
    const next = {
      ingredients: [
        ingredient("meat", "肋排", 400, "克"),
        ingredient("ginger", "姜", 3, "片"),
      ],
      steps: snapshot.steps,
    }
    const applied = applyAcceptedHelp(snapshot, next, [
      ingredientChangeId("change", "meat"),
    ])
    expect(applied.ingredients).toEqual([
      ingredient("meat", "肋排", 400, "克"),
      ingredient("sugar", "冰糖", 20, "克"),
    ])
  })

  test("只接受贴士，不接受步骤正文", () => {
    const next = {
      ingredients: snapshot.ingredients,
      steps: [
        step("s1", "冷水下锅", "一定冷水"),
        step("s2", "炒糖色"),
        step("s3", "收汁"),
      ],
    }
    const applied = applyAcceptedHelp(snapshot, next, [
      tipChangeId("add", "s1"),
    ])
    expect(applied.steps[0]).toEqual({
      id: "s1",
      text: "焯水",
      tip: "一定冷水",
    })
  })

  test("接受新步骤时插到相邻步骤旁边，不接受顺序就保持原序", () => {
    const next = {
      ingredients: snapshot.ingredients,
      steps: [
        step("s1", "焯水"),
        step("s4", "加姜"),
        step("s3", "收汁"),
        step("s2", "炒糖色"),
      ],
    }
    const inserted = applyAcceptedHelp(snapshot, next, [
      stepChangeId("add", "s4"),
    ])
    expect(inserted.steps.map((item) => item.id)).toEqual([
      "s1",
      "s4",
      "s2",
      "s3",
    ])
    const reordered = applyAcceptedHelp(snapshot, next, [
      stepChangeId("add", "s4"),
      HELP_ORDER_CHANGE_ID,
    ])
    expect(reordered.steps.map((item) => item.id)).toEqual([
      "s1",
      "s4",
      "s3",
      "s2",
    ])
  })

  test("不接受删除就留着，本地多出来的用料不动", () => {
    const next = {
      ingredients: [ingredient("meat", "五花肉", 500, "克")],
      steps: snapshot.steps,
    }
    const applied = applyAcceptedHelp(snapshot, next, [])
    expect(applied.ingredients.map((item) => item.id)).toEqual([
      "meat",
      "sugar",
    ])
    const plan = planRecipeItemWrites(
      "rec-1",
      [
        recipeItem({
          id: "local-meat",
          rawName: "五花肉",
          quantity: 500,
          unit: "克",
        }),
        recipeItem({
          id: "local-sugar",
          rawName: "冰糖",
          quantity: 20,
          unit: "克",
          ingredientId: "sugar-id",
        }),
        recipeItem({
          id: "local-extra",
          rawName: "料酒",
          quantity: 1,
          unit: "勺",
          ingredientId: "wine",
        }),
      ],
      snapshot.ingredients,
      applied.ingredients
    )
    expect(plan.removeIds).toEqual([])
    expect(plan.writes.map((item) => item.id)).toEqual([
      "local-meat",
      "local-sugar",
    ])
    expect(plan.writes[0].ingredientId).toBe("ing-1")
  })

  test("改名会重新认食材，只改数量沿用原来的关联", () => {
    const renamed = applyAcceptedHelp(
      snapshot,
      {
        ingredients: [
          ingredient("meat", "肋排", 500, "克"),
          ingredient("sugar", "冰糖", 15, "克"),
        ],
        steps: snapshot.steps,
      },
      [
        ingredientChangeId("change", "meat"),
        ingredientChangeId("change", "sugar"),
      ]
    )
    const plan = planRecipeItemWrites(
      "rec-1",
      [
        recipeItem({
          id: "ri-meat",
          rawName: "五花肉",
          quantity: 500,
          unit: "克",
        }),
        recipeItem({
          id: "ri-sugar",
          rawName: "冰糖",
          quantity: 20,
          unit: "克",
          ingredientId: "sugar-id",
        }),
      ],
      snapshot.ingredients,
      renamed.ingredients
    )
    const meat = plan.writes.find((item) => item.id === "ri-meat")
    const sugar = plan.writes.find((item) => item.id === "ri-sugar")
    expect(meat).toMatchObject({
      rawName: "肋排",
      ingredientId: null,
      matchStatus: "unlinked",
    })
    expect(sugar).toMatchObject({
      quantity: 15,
      ingredientId: "sugar-id",
      matchStatus: "linked",
    })
  })
})

describe("帮改链接存储", () => {
  const snapshot = baseSnapshot(
    [ingredient("meat", "五花肉", 500, "克")],
    [step("s1", "焯水")]
  )

  async function database() {
    const db = createMemoryD1()
    await applyMigrationFiles(db, migrations)
    return db
  }

  test("只有主人能看和关链接，意见过期后仍能看，关掉就不能提交", async () => {
    const db = await database()
    const created = await createRecipeShareLink(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      token: TOKEN,
      ownerName: "测试",
    })
    expect(created).toMatchObject({
      ok: true,
      token: TOKEN,
      helpExpiresAt: "2026-10-08T00:00:00.000Z",
    })
    expect(await listRecipeShareLinks(db, "user-b", "rec-1", NOW)).toEqual([])
    expect(await closeRecipeShareLink(db, "user-b", TOKEN, NOW)).toMatchObject({
      ok: false,
    })

    const open = await readPublicRecipeHelp(
      db,
      TOKEN,
      "2026-10-07T00:00:00.000Z"
    )
    expect(open).toMatchObject({
      ok: true,
      suggestionsOpen: true,
      sourceLabel: "来自测试的分享",
    })

    const expired = await readPublicRecipeHelp(
      db,
      TOKEN,
      "2026-10-08T00:00:00.000Z"
    )
    expect(expired).toMatchObject({
      ok: true,
      suggestionsOpen: false,
      sourceLabel: "来自测试的分享",
    })
    expect(
      await submitRecipeHelp(db, {
        token: TOKEN,
        now: "2026-10-08T00:00:00.000Z",
        body: { author: "妈妈", comment: "五花肉改成 400 克" },
      })
    ).toMatchObject({
      ok: false,
      reason: "修改意见只收到 7 天，现在过了。",
    })
    const stillSaved = await claimRecipeShareSave(db, {
      token: TOKEN,
      userId: "user-b",
      now: "2026-10-08T00:00:00.000Z",
      recipeId: "rec-late",
    })
    expect(stillSaved).toMatchObject({
      ok: true,
      already: false,
      recipeId: "rec-late",
    })

    expect(await closeRecipeShareLink(db, "user-a", TOKEN, NOW)).toMatchObject({
      ok: true,
    })
    expect(await readPublicRecipeHelp(db, TOKEN, NOW)).toMatchObject({
      ok: false,
      reason: "这个链接已经关掉了。",
    })
    expect(
      await submitRecipeHelp(db, {
        token: TOKEN,
        now: NOW,
        body: { author: "妈妈", comment: "五花肉改成 400 克" },
      })
    ).toMatchObject({ ok: false, reason: "这个链接已经关掉了。" })
    expect(
      await claimRecipeShareSave(db, {
        token: TOKEN,
        userId: "user-c",
        now: NOW,
      })
    ).toMatchObject({ ok: false, reason: "这个链接已经关掉了。" })
    const links = await listRecipeShareLinks(db, "user-a", "rec-1", NOW)
    expect(links[0].status).toBe("closed")
    expect(links[0].submissionCount).toBe(0)
    expect(links[0].saveCount).toBe(1)
  })

  test("只给看和收藏的链接不能提意见，同一人重复保存不增加次数", async () => {
    const db = await database()
    const created = await createRecipeShareLink(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      token: TOKEN,
      allowSuggestions: false,
      ownerName: "测试",
    })
    expect(created).toMatchObject({ ok: true, helpExpiresAt: null })
    const opened = await listRecipeShareLinks(db, "user-a", "rec-1", NOW)
    expect(opened[0]).toMatchObject({
      allowSuggestions: false,
      suggestionsOpen: false,
      saveCount: 0,
      ownerName: "测试",
      status: "open",
    })
    expect(
      await submitRecipeHelp(db, {
        token: TOKEN,
        now: NOW,
        body: { author: "妈妈", comment: "少放糖" },
      })
    ).toMatchObject({ ok: false, reason: "这个链接只给看和收藏。" })

    const first = await claimRecipeShareSave(db, {
      token: TOKEN,
      userId: "user-b",
      now: NOW,
      recipeId: "rec-saved",
    })
    expect(first).toMatchObject({
      ok: true,
      already: false,
      recipeId: "rec-saved",
      sourceLabel: "来自测试的分享",
    })
    const again = await claimRecipeShareSave(db, {
      token: TOKEN,
      userId: "user-b",
      now: NOW,
      recipeId: "rec-other",
    })
    expect(again).toMatchObject({
      ok: true,
      already: true,
      recipeId: "rec-saved",
    })
    const other = await claimRecipeShareSave(db, {
      token: TOKEN,
      userId: "user-c",
      now: NOW,
    })
    expect(other).toMatchObject({ ok: true, already: false })
    const links = await listRecipeShareLinks(db, "user-a", "rec-1", NOW)
    expect(links[0].saveCount).toBe(2)
  })

  test("按 token 限制次数，空内容和别人的建议都处理不了", async () => {
    const db = await database()
    await createRecipeShareLink(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      token: TOKEN,
    })
    const bad = await submitRecipeHelp(db, {
      token: TOKEN,
      now: NOW,
      body: { author: "", comment: "少放糖" },
    })
    expect(bad.ok).toBe(false)
    expect(
      (await listRecipeShareLinks(db, "user-a", "rec-1", NOW))[0]
        .submissionCount
    ).toBe(0)

    for (let index = 0; index < HELP_MAX_SUBMISSIONS; index += 1) {
      const saved = await submitRecipeHelp(db, {
        token: TOKEN,
        now: NOW,
        id: `sug-${index}`,
        body: { author: "妈妈", comment: `五花肉改成 ${400 + index} 克` },
        revise: async () => ({
          ingredients: [ingredient("meat", "五花肉", 400 + index, "克")],
          steps: snapshot.steps,
        }),
      })
      expect(saved.ok).toBe(true)
    }
    expect(
      await submitRecipeHelp(db, {
        token: TOKEN,
        now: NOW,
        body: { author: "妈妈", comment: "再少一点" },
      })
    ).toMatchObject({
      ok: false,
      reason: "这个链接收到的修改已经够多了，让对方重新发一个。",
    })

    expect(await countPendingSuggestions(db, "user-a", "rec-1")).toBe(
      HELP_MAX_SUBMISSIONS
    )
    expect(await countPendingSuggestions(db, "user-b", "rec-1")).toBe(0)
    const settled = await resolveRecipeSuggestion(db, {
      userId: "user-a",
      suggestionId: "sug-0",
      decision: "accepted",
      now: NOW,
    })
    expect(settled).toEqual({ ok: true })
    expect(
      await resolveRecipeSuggestion(db, {
        userId: "user-b",
        suggestionId: "sug-1",
        decision: "ignored",
        now: NOW,
      })
    ).toMatchObject({ ok: false })
    expect(
      await resolveRecipeSuggestion(db, {
        userId: "user-a",
        suggestionId: "sug-0",
        decision: "ignored",
        now: NOW,
      })
    ).toMatchObject({ ok: false })

    const listed = await listRecipeSuggestions(db, "user-a", "rec-1")
    expect(listed.find((item) => item.id === "sug-0")?.status).toBe("accepted")
    expect(listed[0].note.author).toBe("妈妈")
    expect(
      listed.find((item) => item.id === "sug-0")?.proposal?.ingredients[0]
        .quantity
    ).toBe(400)
    expect(await countPendingSuggestions(db, "user-a", "rec-1")).toBe(
      HELP_MAX_SUBMISSIONS - 1
    )
  })

  test("同时打开的链接有上限", async () => {
    const db = await database()
    for (let index = 0; index < HELP_MAX_OPEN_LINKS; index += 1) {
      const created = await createRecipeShareLink(db, {
        userId: "user-a",
        recipeId: "rec-1",
        snapshot,
        now: NOW,
        token: `token${String(index).padStart(20, "0")}`,
      })
      expect(created.ok).toBe(true)
    }
    const blocked = await createRecipeShareLink(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      token: "tokentokentokentokentoken",
    })
    expect(blocked).toMatchObject({ ok: false })
    const otherRecipe = await createRecipeShareLink(db, {
      userId: "user-a",
      recipeId: "rec-2",
      snapshot,
      now: NOW,
      token: "anothertokenanothertoken",
    })
    expect(otherRecipe.ok).toBe(true)
  })

  test("模型失败仍留下原话，重新整理后再出现逐项改动", async () => {
    const db = await database()
    await createRecipeShareLink(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      token: TOKEN,
    })
    const saved = await submitRecipeHelp(db, {
      token: TOKEN,
      now: NOW,
      id: "sug-note",
      body: {
        author: "妈妈",
        comment: "少放糖",
        stepNotes: [{ stepId: "s1", text: "冷水下锅" }],
      },
      revise: async () => {
        throw new Error("down")
      },
    })
    expect(saved).toEqual({ ok: true, id: "sug-note" })
    const links = await listRecipeShareLinks(db, "user-a", "rec-1", NOW)
    expect(links[0].submissionCount).toBe(1)
    expect(links[0].pendingCount).toBe(1)
    expect(await countPendingSuggestions(db, "user-a", "rec-1")).toBe(1)
    expect(await listPendingSuggestionCounts(db, "user-a")).toEqual([
      { recipeId: "rec-1", count: 1 },
    ])
    const listed = await listRecipeSuggestions(db, "user-a", "rec-1")
    expect(listed[0].note).toEqual({
      author: "妈妈",
      comment: "少放糖",
      stepNotes: [{ stepId: "s1", text: "冷水下锅" }],
    })
    expect(listed[0].proposal).toBeNull()
    expect(
      await reorganizeRecipeSuggestion(db, {
        userId: "user-a",
        suggestionId: "sug-note",
        revise: async () => null,
      })
    ).toMatchObject({ ok: false, reason: "没整理出来，原话还在。" })
    expect(
      await reorganizeRecipeSuggestion(db, {
        userId: "user-a",
        suggestionId: "sug-note",
        revise: async (current) => ({
          ingredients: [ingredient("meat", "五花肉", 400, "克")],
          steps: current.steps,
        }),
      })
    ).toEqual({ ok: true })
    const organized = await listRecipeSuggestions(db, "user-a", "rec-1")
    expect(organized[0].proposal?.ingredients[0].quantity).toBe(400)
    expect(organized[0].note.comment).toBe("少放糖")
    expect(organized[0].status).toBe("pending")
    await resolveRecipeSuggestion(db, {
      userId: "user-a",
      suggestionId: "sug-note",
      decision: "accepted",
      now: NOW,
    })
    const settled = await listRecipeShareLinks(db, "user-a", "rec-1", NOW)
    expect(settled[0].submissionCount).toBe(1)
    expect(settled[0].pendingCount).toBe(0)
    expect(await listPendingSuggestionCounts(db, "user-a")).toEqual([])
  })

  test("自己的优化不占用分享链接，坏的整理结果不会当成改动", async () => {
    const db = await database()
    const unchanged = await submitSelfRecipeHelp(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      id: "sug-empty",
      body: { comment: "不用改" },
      revise: async (current) => ({
        ingredients: current.ingredients,
        steps: current.steps,
      }),
    })
    expect(unchanged).toEqual({ ok: true, id: "sug-empty" })
    const saved = await submitSelfRecipeHelp(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      id: "sug-self",
      body: { comment: "五花肉改成 300 克" },
      revise: async (current) => ({
        ingredients: [ingredient("meat", "五花肉", 300, "克")],
        steps: current.steps,
      }),
    })
    expect(saved).toEqual({ ok: true, id: "sug-self" })
    const listed = await listRecipeSuggestions(db, "user-a", "rec-1")
    const self = listed.find((item) => item.id === "sug-self")
    expect(self?.note.author).toBe("我")
    expect(self?.snapshot).toEqual(snapshot)
    expect(self?.proposal?.ingredients[0].quantity).toBe(300)
    expect(listed.find((item) => item.id === "sug-empty")?.proposal).toBeNull()
    expect(await listRecipeShareLinks(db, "user-a", "rec-1", NOW)).toEqual([])

    for (let index = 0; index < HELP_MAX_SUBMISSIONS - 2; index += 1) {
      const extra = await submitSelfRecipeHelp(db, {
        userId: "user-a",
        recipeId: "rec-1",
        snapshot,
        now: NOW,
        id: `sug-extra-${index}`,
        body: { comment: "再少一点糖" },
      })
      expect(extra.ok).toBe(true)
    }
    expect(
      await submitSelfRecipeHelp(db, {
        userId: "user-a",
        recipeId: "rec-1",
        snapshot,
        now: NOW,
        body: { comment: "太多了" },
      })
    ).toMatchObject({
      ok: false,
      reason: "还没处理的优化太多了，先看完已有的。",
    })
  })

  test("编辑页的一句话会留下原话，不另外生成分享链接", async () => {
    const db = await database()
    expect(
      await submitSelfRecipeHelp(db, {
        userId: "user-a",
        recipeId: "rec-1",
        snapshot,
        now: NOW,
        body: { comment: "   " },
      })
    ).toMatchObject({ ok: false, reason: "写下想改的地方。" })
    const saved = await submitSelfRecipeHelp(db, {
      userId: "user-a",
      recipeId: "rec-1",
      snapshot,
      now: NOW,
      id: "sug-line",
      body: { comment: "蒜改成 6 瓣" },
      revise: async () => null,
    })
    expect(saved).toEqual({ ok: true, id: "sug-line" })
    const listed = await listRecipeSuggestions(db, "user-a", "rec-1")
    expect(listed).toHaveLength(1)
    expect(listed[0].note).toMatchObject({
      author: "我",
      comment: "蒜改成 6 瓣",
    })
    expect(listed[0].proposal).toBeNull()
    expect(await listRecipeShareLinks(db, "user-a", "rec-1", NOW)).toEqual([])
  })
})
