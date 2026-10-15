import type { AppD1Database } from "@/lib/db/d1"
import { createId } from "@/lib/id"
import {
  HELP_MAX_OPEN_LINKS,
  HELP_MAX_SUBMISSIONS,
  createShareToken,
  decodeHelpPayload,
  encodeHelpPayload,
  helpExpiresAt,
  isHelpToken,
  parseHelpNote,
  parseHelpProposal,
  parseSnapshot,
  shareLinkStatus,
} from "@/lib/recipe-help"
import type {
  HelpNote,
  HelpProposal,
  RecipeHelpSnapshot,
} from "@/lib/recipe-help"

const RECIPE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

export type ShareLinkRecord = {
  token: string
  recipeId: string
  recipeName: string
  createdAt: string
  expiresAt: string
  closedAt: string | null
  submissionCount: number
  status: "open" | "closed" | "expired"
}

export type SuggestionRecord = {
  id: string
  token: string
  author: string
  createdAt: string
  status: "pending" | "accepted" | "ignored"
  snapshot: RecipeHelpSnapshot
  note: HelpNote
  proposal: HelpProposal | null
}

export type HelpReviser = (
  snapshot: RecipeHelpSnapshot,
  note: HelpNote
) => Promise<HelpProposal | null>

type Err = { ok: false; reason: string }

export async function createRecipeShareLink(
  db: AppD1Database,
  input: {
    userId: string
    recipeId: unknown
    snapshot: unknown
    now?: string
    token?: string
  }
): Promise<{ ok: true; token: string; expiresAt: string } | Err> {
  const recipeId = readRecipeId(input.recipeId)
  if (!recipeId) return { ok: false, reason: "菜谱编号不对。" }
  const parsed = parseSnapshot(input.snapshot)
  if (!parsed.ok) return parsed
  const now = asNow(input.now)
  const open = await countOpenLinks(db, input.userId, recipeId, now)
  if (open >= HELP_MAX_OPEN_LINKS) {
    return { ok: false, reason: "打开的链接太多了，先关掉旧的。" }
  }
  const token = input.token ?? createShareToken()
  if (!isHelpToken(token))
    return { ok: false, reason: "链接没生成，请再试一次。" }
  const expiresAt = helpExpiresAt(now)
  try {
    await run(
      db,
      `insert into recipe_share_links (
        token, user_id, recipe_id, recipe_name, snapshot,
        created_at, expires_at, closed_at, submission_count
      ) values (?, ?, ?, ?, ?, ?, ?, null, 0)`,
      token,
      input.userId,
      recipeId,
      parsed.value.name,
      JSON.stringify(parsed.value),
      now,
      expiresAt
    )
  } catch {
    return { ok: false, reason: "链接没生成，请再试一次。" }
  }
  return { ok: true, token, expiresAt }
}

export async function listRecipeShareLinks(
  db: AppD1Database,
  userId: string,
  recipeId: string,
  now = asNow()
): Promise<ShareLinkRecord[]> {
  const result = await all<LinkRow>(
    db,
    `select token, recipe_id, recipe_name, created_at, expires_at, closed_at, submission_count
     from recipe_share_links
     where user_id = ? and recipe_id = ?
     order by created_at desc`,
    userId,
    recipeId
  )
  return result.map((row) => toLink(row, now))
}

export async function closeRecipeShareLink(
  db: AppD1Database,
  userId: string,
  token: string,
  now = asNow()
): Promise<{ ok: true } | Err> {
  if (!isHelpToken(token)) return { ok: false, reason: "没有这个链接。" }
  const updated = await run(
    db,
    `update recipe_share_links
     set closed_at = ?
     where token = ? and user_id = ? and closed_at is null`,
    now,
    token,
    userId
  )
  if (updated.changes > 0) return { ok: true }
  const owned = await all<{ token: string }>(
    db,
    `select token from recipe_share_links where token = ? and user_id = ?`,
    token,
    userId
  )
  if (owned.length > 0) return { ok: true }
  return { ok: false, reason: "没有这个链接。" }
}

export async function readPublicRecipeHelp(
  db: AppD1Database,
  token: string,
  now = asNow()
): Promise<
  | {
      ok: true
      name: string
      servings: number
      expiresAt: string
      snapshot: RecipeHelpSnapshot
    }
  | Err
> {
  const link = await loadLink(db, token)
  if (!link) return { ok: false, reason: "没有这个帮改链接。" }
  const status = shareLinkStatus(
    { expiresAt: link.expires_at, closedAt: link.closed_at },
    now
  )
  if (status === "closed") {
    return { ok: false, reason: "这个帮改链接已经关掉了，让对方重新发一个。" }
  }
  if (status === "expired") {
    return { ok: false, reason: "这个帮改链接已经失效，让对方重新发一个。" }
  }
  const snapshot = parseStoredSnapshot(link.snapshot)
  if (!snapshot)
    return { ok: false, reason: "这个帮改链接坏了，让对方重新发一个。" }
  return {
    ok: true,
    name: snapshot.name,
    servings: snapshot.servings,
    expiresAt: link.expires_at,
    snapshot,
  }
}

export async function submitRecipeHelp(
  db: AppD1Database,
  input: {
    token: string
    body: unknown
    now?: string
    id?: string
    revise?: HelpReviser
  }
): Promise<{ ok: true; id: string } | Err> {
  if (!isHelpToken(input.token))
    return { ok: false, reason: "没有这个帮改链接。" }
  const now = asNow(input.now)
  const link = await loadLink(db, input.token)
  if (!link) return { ok: false, reason: "没有这个帮改链接。" }
  const status = shareLinkStatus(
    { expiresAt: link.expires_at, closedAt: link.closed_at },
    now
  )
  if (status === "closed") {
    return { ok: false, reason: "这个帮改链接已经关掉了，让对方重新发一个。" }
  }
  if (status === "expired") {
    return { ok: false, reason: "这个帮改链接已经失效，让对方重新发一个。" }
  }
  const snapshot = parseStoredSnapshot(link.snapshot)
  if (!snapshot)
    return { ok: false, reason: "这个帮改链接坏了，让对方重新发一个。" }
  if (link.submission_count >= HELP_MAX_SUBMISSIONS) {
    return {
      ok: false,
      reason: "这个链接收到的修改已经够多了，让对方重新发一个。",
    }
  }
  const note = parseHelpNote(input.body, snapshot)
  if (!note.ok) return note
  const reserved = await run(
    db,
    `update recipe_share_links
     set submission_count = submission_count + 1
     where token = ?
       and closed_at is null
       and expires_at > ?
       and submission_count < ?`,
    input.token,
    now,
    HELP_MAX_SUBMISSIONS
  )
  if (reserved.changes !== 1) {
    return { ok: false, reason: "这个链接现在不能提交，让对方重新发一个。" }
  }
  const proposal = await organize(snapshot, note.value, input.revise)
  const id = input.id ?? createId("sug")
  await insertSuggestion(db, {
    id,
    token: input.token,
    userId: link.user_id,
    recipeId: link.recipe_id,
    author: note.value.author,
    payload: encodeHelpPayload({ note: note.value, proposal }),
    now,
  })
  return { ok: true, id }
}

export async function submitSelfRecipeHelp(
  db: AppD1Database,
  input: {
    userId: string
    recipeId: unknown
    snapshot: unknown
    body: unknown
    now?: string
    id?: string
    revise?: HelpReviser
  }
): Promise<{ ok: true; id: string } | Err> {
  const recipeId = readRecipeId(input.recipeId)
  if (!recipeId) return { ok: false, reason: "菜谱编号不对。" }
  const snapshot = parseSnapshot(input.snapshot)
  if (!snapshot.ok) return snapshot
  const note = parseHelpNote(
    { ...(asBody(input.body) ?? {}), author: "我" },
    snapshot.value
  )
  if (!note.ok) return note
  const now = asNow(input.now)
  const pending = await countSelfPending(db, input.userId, recipeId)
  if (pending >= HELP_MAX_SUBMISSIONS) {
    return { ok: false, reason: "还没处理的优化太多了，先看完已有的。" }
  }
  const proposal = await organize(snapshot.value, note.value, input.revise)
  const id = input.id ?? createId("sug")
  const token = createShareToken()
  await insertSuggestion(db, {
    id,
    token,
    userId: input.userId,
    recipeId,
    author: note.value.author,
    payload: encodeHelpPayload({
      note: note.value,
      proposal,
      snapshot: snapshot.value,
    }),
    now,
  })
  return { ok: true, id }
}

export async function reorganizeRecipeSuggestion(
  db: AppD1Database,
  input: {
    userId: string
    suggestionId: string
    revise?: HelpReviser
  }
): Promise<{ ok: true } | Err> {
  if (!input.suggestionId.trim()) return { ok: false, reason: "没有这条建议。" }
  const row = await loadOwnedSuggestion(db, input.userId, input.suggestionId)
  if (!row) return { ok: false, reason: "没有这条建议。" }
  if (row.status !== "pending") {
    return { ok: false, reason: "这条建议已经处理过了。" }
  }
  const link = await loadLink(db, row.token)
  const decoded = decodeHelpPayload(
    row.payload,
    link ? parseStoredSnapshot(link.snapshot) : null
  )
  if (!decoded) return { ok: false, reason: "这条建议读不出来。" }
  const proposal = await organize(decoded.snapshot, decoded.note, input.revise)
  if (!proposal) return { ok: false, reason: "没整理出来，原话还在。" }
  const checked = parseHelpProposal(proposal, decoded.snapshot)
  if (!checked.ok) return { ok: false, reason: "没整理出来，原话还在。" }
  const updated = await run(
    db,
    `update recipe_suggestions
     set payload = ?
     where id = ? and user_id = ? and status = 'pending'`,
    encodeHelpPayload({
      note: decoded.note,
      proposal: checked.value,
      snapshot: link ? undefined : decoded.snapshot,
    }),
    input.suggestionId,
    input.userId
  )
  if (updated.changes !== 1) {
    return { ok: false, reason: "这条建议已经处理过了。" }
  }
  return { ok: true }
}

export async function listRecipeSuggestions(
  db: AppD1Database,
  userId: string,
  recipeId: string
): Promise<SuggestionRecord[]> {
  const rows = await all<SuggestionRow>(
    db,
    `select s.id, s.token, s.author, s.payload, s.status, s.created_at, l.snapshot as link_snapshot
     from recipe_suggestions s
     left join recipe_share_links l on l.token = s.token
     where s.user_id = ? and s.recipe_id = ?
     order by s.created_at desc`,
    userId,
    recipeId
  )
  const suggestions: SuggestionRecord[] = []
  for (const row of rows) {
    if (
      row.status !== "pending" &&
      row.status !== "accepted" &&
      row.status !== "ignored"
    ) {
      continue
    }
    const decoded = decodeHelpPayload(
      row.payload,
      row.link_snapshot ? parseStoredSnapshot(row.link_snapshot) : null
    )
    if (!decoded) continue
    suggestions.push({
      id: row.id,
      token: row.token,
      author: row.author,
      createdAt: row.created_at,
      status: row.status,
      snapshot: decoded.snapshot,
      note: decoded.note,
      proposal: decoded.proposal,
    })
  }
  return suggestions
}

export async function countPendingSuggestions(
  db: AppD1Database,
  userId: string,
  recipeId: string
): Promise<number> {
  const rows = await all<{ count: number }>(
    db,
    `select count(*) as count from recipe_suggestions
     where user_id = ? and recipe_id = ? and status = 'pending'`,
    userId,
    recipeId
  )
  return Number(rows[0]?.count ?? 0)
}

export async function resolveRecipeSuggestion(
  db: AppD1Database,
  input: {
    userId: string
    suggestionId: string
    decision: "accepted" | "ignored"
    now?: string
  }
): Promise<{ ok: true } | Err> {
  if (input.decision !== "accepted" && input.decision !== "ignored") {
    return { ok: false, reason: "处理方式不对。" }
  }
  if (!input.suggestionId.trim()) return { ok: false, reason: "没有这条建议。" }
  const now = asNow(input.now)
  const updated = await run(
    db,
    `update recipe_suggestions
     set status = ?, resolved_at = ?
     where id = ? and user_id = ? and status = 'pending'`,
    input.decision,
    now,
    input.suggestionId,
    input.userId
  )
  if (updated.changes === 1) return { ok: true }
  return { ok: false, reason: "这条建议已经处理过了。" }
}

type LinkRow = {
  token: string
  user_id: string
  recipe_id: string
  recipe_name: string
  snapshot: string
  created_at: string
  expires_at: string
  closed_at: string | null
  submission_count: number
}

type SuggestionRow = {
  id: string
  token: string
  author: string
  payload: string
  status: string
  created_at: string
  link_snapshot: string | null
}

type OwnedSuggestionRow = {
  id: string
  token: string
  payload: string
  status: string
}

function toLink(row: LinkRow, now: string): ShareLinkRecord {
  const closedAt = row.closed_at || null
  return {
    token: row.token,
    recipeId: row.recipe_id,
    recipeName: row.recipe_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    closedAt,
    submissionCount: Number(row.submission_count ?? 0),
    status: shareLinkStatus({ expiresAt: row.expires_at, closedAt }, now),
  }
}

async function loadLink(
  db: AppD1Database,
  token: string
): Promise<LinkRow | null> {
  if (!isHelpToken(token)) return null
  const rows = await all<LinkRow>(
    db,
    `select token, user_id, recipe_id, recipe_name, snapshot, created_at, expires_at, closed_at, submission_count
     from recipe_share_links where token = ?`,
    token
  )
  return rows[0] ?? null
}

async function countOpenLinks(
  db: AppD1Database,
  userId: string,
  recipeId: string,
  now: string
): Promise<number> {
  const rows = await all<{ count: number }>(
    db,
    `select count(*) as count from recipe_share_links
     where user_id = ? and recipe_id = ? and closed_at is null and expires_at > ?`,
    userId,
    recipeId,
    now
  )
  return Number(rows[0]?.count ?? 0)
}

function parseStoredSnapshot(raw: string): RecipeHelpSnapshot | null {
  try {
    const parsed = parseSnapshot(JSON.parse(raw))
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}

async function organize(
  snapshot: RecipeHelpSnapshot,
  note: HelpNote,
  revise?: HelpReviser
): Promise<HelpProposal | null> {
  if (!revise) return null
  try {
    const proposal = await revise(snapshot, note)
    if (!proposal) return null
    const parsed = parseHelpProposal(proposal, snapshot)
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}

async function insertSuggestion(
  db: AppD1Database,
  input: {
    id: string
    token: string
    userId: string
    recipeId: string
    author: string
    payload: string
    now: string
  }
): Promise<void> {
  await run(
    db,
    `insert into recipe_suggestions (
      id, token, user_id, recipe_id, author, payload, status, created_at, resolved_at
    ) values (?, ?, ?, ?, ?, ?, 'pending', ?, null)`,
    input.id,
    input.token,
    input.userId,
    input.recipeId,
    input.author,
    input.payload,
    input.now
  )
}

async function loadOwnedSuggestion(
  db: AppD1Database,
  userId: string,
  suggestionId: string
): Promise<OwnedSuggestionRow | null> {
  const rows = await all<OwnedSuggestionRow>(
    db,
    `select id, token, payload, status
     from recipe_suggestions
     where id = ? and user_id = ?`,
    suggestionId,
    userId
  )
  return rows[0] ?? null
}

async function countSelfPending(
  db: AppD1Database,
  userId: string,
  recipeId: string
): Promise<number> {
  const rows = await all<{ count: number }>(
    db,
    `select count(*) as count
     from recipe_suggestions s
     left join recipe_share_links l on l.token = s.token
     where s.user_id = ? and s.recipe_id = ? and s.status = 'pending' and l.token is null`,
    userId,
    recipeId
  )
  return Number(rows[0]?.count ?? 0)
}

function asBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readRecipeId(value: unknown): string | null {
  if (typeof value !== "string" || !RECIPE_ID_RE.test(value)) return null
  return value
}

function asNow(now?: string): string {
  if (now && !Number.isNaN(Date.parse(now))) return new Date(now).toISOString()
  return new Date().toISOString()
}

async function all<T>(
  db: AppD1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>()
  return result.results
}

async function run(
  db: AppD1Database,
  sql: string,
  ...params: unknown[]
): Promise<{ changes: number }> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all()
  return { changes: Number(result.meta.changes ?? 0) }
}
