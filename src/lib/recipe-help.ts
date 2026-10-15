import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { sanitizeStepTips } from "@/lib/recipe-organize"
import type { Recipe, RecipeItem } from "@/lib/types"

export const HELP_SHARE_DAYS = 7
export const HELP_MAX_SUBMISSIONS = 8
export const HELP_MAX_OPEN_LINKS = 10
export const HELP_ORDER_CHANGE_ID = "steps:order"

export const HELP_LIMITS = {
  maxNameLength: 80,
  maxIngredients: 40,
  maxIngredientName: 40,
  maxUnitLength: 8,
  maxQuantity: 9999,
  maxSteps: 30,
  maxStepLength: 200,
  maxTipLength: 80,
  maxAuthorLength: 20,
  maxCommentLength: 500,
  maxStepNoteLength: 120,
  maxSnapshotBytes: 24_000,
  maxIdLength: 80,
} as const

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/

export type HelpIngredient = {
  id: string
  rawName: string
  quantity: number
  unit: string
}

export type HelpStep = {
  id: string
  text: string
  tip: string
}

export type RecipeHelpSnapshot = {
  name: string
  servings: number
  ingredients: HelpIngredient[]
  steps: HelpStep[]
}

export type HelpStepNote = {
  stepId: string
  text: string
}

export type HelpNote = {
  author: string
  comment: string
  stepNotes: HelpStepNote[]
}

export type HelpProposal = {
  ingredients: HelpIngredient[]
  steps: HelpStep[]
}

export type HelpStoredPayload = {
  note: HelpNote
  proposal: HelpProposal | null
  snapshot?: RecipeHelpSnapshot
}

export type HelpChangeKind = "add" | "remove" | "change" | "move"

export type HelpChange = {
  id: string
  group: "ingredient" | "step" | "tip" | "order"
  kind: HelpChangeKind
  label: string
  before: string
  after: string
}

export type HelpResult<T> =
  { ok: true; value: T } | { ok: false; reason: string }

export function ingredientChangeId(
  kind: "add" | "remove" | "change",
  id: string
): string {
  return `ing:${kind}:${id}`
}

export function stepChangeId(
  kind: "add" | "remove" | "change",
  id: string
): string {
  return `step:${kind}:${id}`
}

export function tipChangeId(
  kind: "add" | "remove" | "change",
  id: string
): string {
  return `tip:${kind}:${id}`
}

export function isHelpToken(value: string): boolean {
  return TOKEN_RE.test(value)
}

export function createShareToken(
  random: (size: number) => Uint8Array = randomBytes
): string {
  return bytesToBase64Url(random(18))
}

export function helpExpiresAt(nowIso: string): string {
  const date = new Date(nowIso)
  date.setUTCDate(date.getUTCDate() + HELP_SHARE_DAYS)
  return date.toISOString()
}

export function shareLinkStatus(link: {
  closedAt: string | null
}): "open" | "closed" {
  if (link.closedAt) return "closed"
  return "open"
}

export function suggestionsOpen(
  link: {
    allowSuggestions: boolean
    helpExpiresAt: string | null
    closedAt: string | null
  },
  nowIso: string
): boolean {
  if (link.closedAt || !link.allowSuggestions || !link.helpExpiresAt)
    return false
  return link.helpExpiresAt > nowIso
}

export function shareSourceLabel(ownerName: string): string {
  const name = ownerName.trim()
  return name ? `来自${name}的分享` : "来自分享"
}

export function helpReturnPath(value: string): string | null {
  if (!/^\/help\/[A-Za-z0-9_-]{22,64}$/.test(value)) return null
  return value
}

export function formatHelpWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`
}

export function formatHelpIngredient(item: HelpIngredient): string {
  return `${item.rawName} ${formatQuantity(item.quantity)}${item.unit}`
}

export function snapshotFromRecipe(
  recipe: Recipe,
  items: RecipeItem[]
): HelpResult<RecipeHelpSnapshot> {
  const tips = recipe.stepTips ?? []
  return parseSnapshot({
    name: recipe.name,
    servings: Math.min(99, Math.max(1, Math.round(recipe.servings) || 1)),
    ingredients: items.map((item) => ({
      id: item.id,
      rawName: item.rawName,
      quantity: item.quantity,
      unit: item.unit,
    })),
    steps: recipe.steps.map((text, index) => ({
      id: `s${index + 1}`,
      text,
      tip: tips[index] ?? "",
    })),
  })
}

export function parseSnapshot(value: unknown): HelpResult<RecipeHelpSnapshot> {
  const record = asRecord(value)
  if (!record) return fail("菜谱内容不对。")
  const name = cleanText(record.name, HELP_LIMITS.maxNameLength)
  if (!name) return fail("菜名空了或太长。")
  const servings = readServings(record.servings)
  if (servings == null) return fail("份数不对。")
  const ingredients = readIngredients(record.ingredients)
  if (!ingredients.ok) return ingredients
  const steps = readSteps(record.steps)
  if (!steps.ok) return steps
  const snapshot: RecipeHelpSnapshot = {
    name,
    servings,
    ingredients: ingredients.value,
    steps: steps.value,
  }
  if (byteLength(snapshot) > HELP_LIMITS.maxSnapshotBytes) {
    return fail("内容太长了，缩短一点再提交。")
  }
  return { ok: true, value: snapshot }
}

export function parseHelpNote(
  value: unknown,
  snapshot: RecipeHelpSnapshot
): HelpResult<HelpNote> {
  const record = asRecord(value)
  if (!record) return fail("修改内容不对。")
  const author = cleanText(record.author, HELP_LIMITS.maxAuthorLength)
  if (!author) return fail("写下署名，例如妈妈。")
  const comment = cleanOptional(record.comment, HELP_LIMITS.maxCommentLength)
  if (comment == null) return fail("意见太长了，缩短一点再提交。")
  const stepNotes = readStepNotes(record.stepNotes, snapshot)
  if (!stepNotes.ok) return stepNotes
  if (!comment && stepNotes.value.length === 0) {
    return fail("写下想改的地方。")
  }
  const note: HelpNote = {
    author,
    comment,
    stepNotes: stepNotes.value,
  }
  if (byteLength(note) > HELP_LIMITS.maxSnapshotBytes) {
    return fail("内容太长了，缩短一点再提交。")
  }
  return { ok: true, value: note }
}

export function parseHelpProposal(
  value: unknown,
  snapshot: RecipeHelpSnapshot
): HelpResult<HelpProposal> {
  const record = asRecord(value)
  if (!record) return fail("修改内容不对。")
  const ingredients = readIngredients(record.ingredients)
  if (!ingredients.ok) return ingredients
  const steps = readSteps(record.steps)
  if (!steps.ok) return steps
  const proposal: HelpProposal = {
    ingredients: ingredients.value,
    steps: steps.value,
  }
  if (byteLength(proposal) > HELP_LIMITS.maxSnapshotBytes) {
    return fail("内容太长了，缩短一点再提交。")
  }
  if (helpChanges(snapshot, proposal).length === 0) {
    return fail("没整理出改动。")
  }
  return { ok: true, value: proposal }
}

export function encodeHelpPayload(payload: HelpStoredPayload): string {
  return JSON.stringify(payload)
}

export function decodeHelpPayload(
  raw: string,
  linkSnapshot: RecipeHelpSnapshot | null
): {
  snapshot: RecipeHelpSnapshot
  note: HelpNote
  proposal: HelpProposal | null
} | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const record = asRecord(value)
  if (!record) return null
  const embedded = record.snapshot ? parseSnapshot(record.snapshot) : null
  const snapshot = linkSnapshot ?? (embedded?.ok ? embedded.value : null)
  if (!snapshot) return null
  const note = parseHelpNote(record.note, snapshot)
  if (!note.ok) return null
  if (record.proposal == null) {
    return { snapshot, note: note.value, proposal: null }
  }
  const proposal = parseHelpProposal(record.proposal, snapshot)
  return {
    snapshot,
    note: note.value,
    proposal: proposal.ok ? proposal.value : null,
  }
}

export function helpChanges(
  base: RecipeHelpSnapshot,
  next: HelpProposal
): HelpChange[] {
  return [
    ...ingredientChanges(base.ingredients, next.ingredients),
    ...stepChanges(base.steps, next.steps),
  ]
}

export function applyAcceptedHelp(
  base: RecipeHelpSnapshot,
  next: HelpProposal,
  acceptedIds: readonly string[]
): { ingredients: HelpIngredient[]; steps: HelpStep[] } {
  const accepted = new Set(acceptedIds)
  return {
    ingredients: applyIngredients(base.ingredients, next.ingredients, accepted),
    steps: applySteps(base.steps, next.steps, accepted),
  }
}

export function recipeStepsFromHelp(steps: HelpStep[]): {
  steps: string[]
  stepTips?: string[]
} {
  const texts = steps.map((step) => step.text)
  const stepTips = sanitizeStepTips(
    texts,
    steps.map((step) => step.tip)
  )
  return stepTips ? { steps: texts, stepTips } : { steps: texts }
}

export function planRecipeItemWrites(
  recipeId: string,
  current: RecipeItem[],
  base: HelpIngredient[],
  desired: HelpIngredient[]
): { removeIds: string[]; writes: RecipeItem[] } {
  const unused = new Set(current.map((item) => item.id))
  const baseById = new Map(base.map((item) => [item.id, item]))
  const desiredIds = new Set(desired.map((item) => item.id))

  function take(match: (item: RecipeItem) => boolean): RecipeItem | undefined {
    const found = current.find((item) => unused.has(item.id) && match(item))
    if (!found) return undefined
    unused.delete(found.id)
    return found
  }

  function takeKnown(id: string): RecipeItem | undefined {
    const direct = take((item) => item.id === id)
    if (direct) return direct
    const origin = baseById.get(id)
    if (!origin) return undefined
    return take(
      (item) =>
        item.rawName === origin.rawName &&
        item.unit === origin.unit &&
        item.quantity === origin.quantity
    )
  }

  const writes = desired.map((item) => {
    const prev = takeKnown(item.id)
    return recipeItemFromHelp(recipeId, item, prev)
  })
  const removeIds: string[] = []
  for (const origin of base) {
    if (desiredIds.has(origin.id)) continue
    const prev = takeKnown(origin.id)
    if (prev) removeIds.push(prev.id)
  }
  return { removeIds, writes }
}

function recipeItemFromHelp(
  recipeId: string,
  item: HelpIngredient,
  prev: RecipeItem | undefined
): RecipeItem {
  const nameChanged =
    !prev ||
    normalizeIngredientName(prev.rawName) !==
      normalizeIngredientName(item.rawName)
  if (!prev || nameChanged) {
    return {
      id: prev?.id ?? item.id,
      recipeId,
      rawName: item.rawName,
      quantity: item.quantity,
      unit: item.unit,
      ingredientId: null,
      matchStatus: "unlinked",
    }
  }
  return {
    ...prev,
    rawName: item.rawName,
    quantity: item.quantity,
    unit: item.unit,
  }
}

function ingredientChanges(
  base: HelpIngredient[],
  next: HelpIngredient[]
): HelpChange[] {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const nextById = new Map(next.map((item) => [item.id, item]))
  const changes: HelpChange[] = []
  for (const item of base) {
    const proposed = nextById.get(item.id)
    if (!proposed) {
      changes.push({
        id: ingredientChangeId("remove", item.id),
        group: "ingredient",
        kind: "remove",
        label: item.rawName,
        before: formatHelpIngredient(item),
        after: "",
      })
      continue
    }
    if (!sameIngredient(item, proposed)) {
      changes.push({
        id: ingredientChangeId("change", item.id),
        group: "ingredient",
        kind: "change",
        label: proposed.rawName,
        before: formatHelpIngredient(item),
        after: formatHelpIngredient(proposed),
      })
    }
  }
  for (const item of next) {
    if (baseById.has(item.id)) continue
    changes.push({
      id: ingredientChangeId("add", item.id),
      group: "ingredient",
      kind: "add",
      label: item.rawName,
      before: "",
      after: formatHelpIngredient(item),
    })
  }
  return changes
}

function stepChanges(base: HelpStep[], next: HelpStep[]): HelpChange[] {
  const baseById = new Map(base.map((step) => [step.id, step]))
  const nextById = new Map(next.map((step) => [step.id, step]))
  const changes: HelpChange[] = []
  base.forEach((step, index) => {
    const proposed = nextById.get(step.id)
    const label = `第${index + 1}步`
    if (!proposed) {
      changes.push({
        id: stepChangeId("remove", step.id),
        group: "step",
        kind: "remove",
        label,
        before: stepBody(step),
        after: "",
      })
      return
    }
    if (step.text !== proposed.text) {
      changes.push({
        id: stepChangeId("change", step.id),
        group: "step",
        kind: "change",
        label,
        before: step.text,
        after: proposed.text,
      })
    }
    const tipKind = tipChangeKind(step.tip, proposed.tip)
    if (tipKind) {
      changes.push({
        id: tipChangeId(tipKind, step.id),
        group: "tip",
        kind: tipKind,
        label: `${label}贴士`,
        before: step.tip,
        after: proposed.tip,
      })
    }
  })
  next.forEach((step) => {
    if (baseById.has(step.id)) return
    changes.push({
      id: stepChangeId("add", step.id),
      group: "step",
      kind: "add",
      label: "新步骤",
      before: "",
      after: stepBody(step),
    })
  })
  const commonBefore = base
    .map((step) => step.id)
    .filter((id) => nextById.has(id))
  const commonAfter = next
    .map((step) => step.id)
    .filter((id) => baseById.has(id))
  if (commonBefore.join("|") !== commonAfter.join("|")) {
    changes.push({
      id: HELP_ORDER_CHANGE_ID,
      group: "order",
      kind: "move",
      label: "步骤顺序",
      before: orderText(base, commonBefore),
      after: orderText(next, commonAfter),
    })
  }
  return changes
}

function applyIngredients(
  base: HelpIngredient[],
  next: HelpIngredient[],
  accepted: Set<string>
): HelpIngredient[] {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const nextById = new Map(next.map((item) => [item.id, item]))
  const kept: HelpIngredient[] = []
  for (const item of base) {
    const proposed = nextById.get(item.id)
    if (!proposed) {
      if (accepted.has(ingredientChangeId("remove", item.id))) continue
      kept.push({ ...item })
      continue
    }
    if (
      !sameIngredient(item, proposed) &&
      accepted.has(ingredientChangeId("change", item.id))
    ) {
      kept.push({ ...proposed })
    } else {
      kept.push({ ...item })
    }
  }
  for (const item of next) {
    if (baseById.has(item.id)) continue
    if (!accepted.has(ingredientChangeId("add", item.id))) continue
    kept.push({ ...item })
  }
  return kept
}

function applySteps(
  base: HelpStep[],
  next: HelpStep[],
  accepted: Set<string>
): HelpStep[] {
  const baseById = new Map(base.map((step) => [step.id, step]))
  const nextById = new Map(next.map((step) => [step.id, step]))
  const content = new Map<string, HelpStep>()

  for (const step of base) {
    const proposed = nextById.get(step.id)
    if (!proposed) {
      if (accepted.has(stepChangeId("remove", step.id))) continue
      content.set(step.id, { ...step })
      continue
    }
    let text = step.text
    let tip = step.tip
    if (
      step.text !== proposed.text &&
      accepted.has(stepChangeId("change", step.id))
    ) {
      text = proposed.text
    }
    const tipKind = tipChangeKind(step.tip, proposed.tip)
    if (tipKind && accepted.has(tipChangeId(tipKind, step.id))) {
      tip = proposed.tip
    }
    content.set(step.id, { id: step.id, text, tip })
  }

  for (const step of next) {
    if (baseById.has(step.id)) continue
    if (!accepted.has(stepChangeId("add", step.id))) continue
    content.set(step.id, { ...step })
  }

  const commonBefore = base
    .map((step) => step.id)
    .filter((id) => nextById.has(id) && content.has(id))
  const commonAfter = next
    .map((step) => step.id)
    .filter((id) => baseById.has(id) && content.has(id))
  const orderDiffers = commonBefore.join("|") !== commonAfter.join("|")
  let ordered: string[]
  if (orderDiffers && accepted.has(HELP_ORDER_CHANGE_ID)) {
    ordered = next.map((step) => step.id).filter((id) => content.has(id))
    const missing = base
      .map((step) => step.id)
      .filter((id) => content.has(id) && !ordered.includes(id))
    ordered = insertByNeighbors(
      ordered,
      missing,
      base.map((step) => step.id)
    )
  } else {
    ordered = base.map((step) => step.id).filter((id) => content.has(id))
    ordered = insertAdds(ordered, next, content)
  }
  return ordered.map((id) => content.get(id) as HelpStep)
}

function insertAdds(
  ordered: string[],
  next: HelpStep[],
  content: Map<string, HelpStep>
): string[] {
  const result = [...ordered]
  for (const step of next) {
    if (result.includes(step.id) || !content.has(step.id)) continue
    const nextIndex = next.findIndex((row) => row.id === step.id)
    const before = nearestPlaced(next, nextIndex, -1, result)
    if (before) {
      result.splice(result.indexOf(before) + 1, 0, step.id)
      continue
    }
    const after = nearestPlaced(next, nextIndex, 1, result)
    if (after) {
      result.splice(result.indexOf(after), 0, step.id)
      continue
    }
    result.push(step.id)
  }
  return result
}

function insertByNeighbors(
  ordered: string[],
  missing: string[],
  original: string[]
): string[] {
  const result = [...ordered]
  for (const id of missing) {
    const originIndex = original.indexOf(id)
    const before = nearestInList(original, originIndex, -1, result)
    if (before) {
      result.splice(result.indexOf(before) + 1, 0, id)
      continue
    }
    const after = nearestInList(original, originIndex, 1, result)
    if (after) {
      result.splice(result.indexOf(after), 0, id)
      continue
    }
    result.push(id)
  }
  return result
}

function nearestPlaced(
  steps: HelpStep[],
  index: number,
  direction: -1 | 1,
  placed: string[]
): string | null {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < steps.length;
    cursor += direction
  ) {
    if (placed.includes(steps[cursor].id)) return steps[cursor].id
  }
  return null
}

function nearestInList(
  ids: string[],
  index: number,
  direction: -1 | 1,
  placed: string[]
): string | null {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < ids.length;
    cursor += direction
  ) {
    if (placed.includes(ids[cursor])) return ids[cursor]
  }
  return null
}

function readStepNotes(
  value: unknown,
  snapshot: RecipeHelpSnapshot
): HelpResult<HelpStepNote[]> {
  if (value == null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return fail("步骤意见格式不对。")
  if (value.length > HELP_LIMITS.maxSteps) {
    return fail("步骤意见太多了。")
  }
  const known = new Set(snapshot.steps.map((step) => step.id))
  const notes: HelpStepNote[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const record = asRecord(entry)
    if (!record) return fail("步骤意见格式不对。")
    const stepId = readId(record.stepId)
    if (!stepId || !known.has(stepId)) return fail("这一步不在菜谱里。")
    if (seen.has(stepId)) return fail("同一步写了两次。")
    seen.add(stepId)
    const text = readLimited(record.text, HELP_LIMITS.maxStepNoteLength)
    if (text === "invalid") return fail("步骤意见格式不对。")
    if (text === "long") return fail("这一步的意见太长了。")
    if (text === "empty") continue
    notes.push({ stepId, text })
  }
  return { ok: true, value: notes }
}

function readIngredients(value: unknown): HelpResult<HelpIngredient[]> {
  if (!Array.isArray(value)) return fail("食材格式不对。")
  if (value.length > HELP_LIMITS.maxIngredients) {
    return fail("食材太多了，删掉一些再提交。")
  }
  const ingredients: HelpIngredient[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const record = asRecord(entry)
    if (!record) return fail("食材格式不对。")
    const id = readId(record.id)
    if (!id) return fail("食材编号不对。")
    if (seen.has(id)) return fail("食材重复了。")
    seen.add(id)
    const rawName = cleanText(record.rawName, HELP_LIMITS.maxIngredientName)
    if (!rawName) return fail("食材名空了或太长。")
    const quantity = readQuantity(record.quantity)
    if (quantity == null) return fail("数量要是 0 到 9999 的数字。")
    const unit = cleanText(record.unit, HELP_LIMITS.maxUnitLength)
    if (!unit) return fail("单位空了或太长。")
    ingredients.push({ id, rawName, quantity, unit })
  }
  return { ok: true, value: ingredients }
}

function readSteps(value: unknown): HelpResult<HelpStep[]> {
  if (!Array.isArray(value)) return fail("步骤格式不对。")
  if (value.length > HELP_LIMITS.maxSteps) {
    return fail("步骤太多了，删掉一些再提交。")
  }
  const steps: HelpStep[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const record = asRecord(entry)
    if (!record) return fail("步骤格式不对。")
    const id = readId(record.id)
    if (!id) return fail("步骤编号不对。")
    if (seen.has(id)) return fail("步骤重复了。")
    seen.add(id)
    const text = cleanText(record.text, HELP_LIMITS.maxStepLength)
    if (!text) return fail("步骤空了或太长。")
    const tip = cleanOptional(record.tip, HELP_LIMITS.maxTipLength)
    if (tip == null) return fail("贴士太长了。")
    steps.push({ id, text, tip })
  }
  return { ok: true, value: steps }
}

function sameIngredient(left: HelpIngredient, right: HelpIngredient): boolean {
  return (
    left.rawName === right.rawName &&
    left.quantity === right.quantity &&
    left.unit === right.unit
  )
}

function tipChangeKind(
  before: string,
  after: string
): "add" | "remove" | "change" | null {
  if (before === after) return null
  if (!before && after) return "add"
  if (before && !after) return "remove"
  return "change"
}

function stepBody(step: HelpStep): string {
  return step.tip ? `${step.text}（贴士：${step.tip}）` : step.text
}

function orderText(steps: HelpStep[], ids: string[]): string {
  return ids
    .map((id, index) => {
      const step = steps.find((item) => item.id === id)
      const text = (step?.text ?? "").replace(/\s+/g, " ")
      const short = text.length > 12 ? `${text.slice(0, 12)}…` : text
      return `${index + 1}.${short}`
    })
    .join(" ")
}

function readServings(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 99) return null
  return number
}

function readQuantity(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(String(value ?? ""))
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > HELP_LIMITS.maxQuantity
  ) {
    return null
  }
  return Math.round(number * 1000) / 1000
}

function readId(value: unknown): string | null {
  if (typeof value !== "string" || !ID_RE.test(value)) return null
  return value
}

function cleanText(value: unknown, max: number): string | null {
  const text = readLimited(value, max)
  if (text === "invalid" || text === "empty" || text === "long") return null
  return text
}

function readLimited(
  value: unknown,
  max: number
): string | "invalid" | "empty" | "long" {
  if (typeof value !== "string") return "invalid"
  const text = stripControls(value).trim()
  if (!text) return "empty"
  if (text.length > max) return "long"
  return text
}

function cleanOptional(value: unknown, max: number): string | null {
  if (value == null) return ""
  if (typeof value !== "string") return null
  const text = stripControls(value).trim()
  if (text.length > max) return null
  return text
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

function fail<T>(reason: string): HelpResult<T> {
  return { ok: false, reason }
}

function formatQuantity(value: number): string {
  return String(value)
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}
