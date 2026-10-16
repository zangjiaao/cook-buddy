# cook-buddy

帮我烹饪的搭子，除了重复造轮子之外，加一些自己的习惯，这不就是vibe-coding的乐趣吗

中文名：**做饭搭子**。本地优先的做饭闭环 PWA：看库存 → 排这几天吃什么 → 生成菜市场购买清单 → 买回来入库 → 按食谱做并扣库存。

## 本地运行

需要 Node 20+ 和 [pnpm](https://pnpm.io)。

```bash
pnpm install
cp .env.example .env.local          # 只要 DeepSeek key，不要提交
cp .dev.vars.example .dev.vars      # 本地 Worker 的 BETTER_AUTH_SECRET，不要提交
pnpm dev
```

浏览器打开 http://localhost:3000 。不登录时，数据只在本机 IndexedDB，和以前一样。

本地账号和同步还要用本机 D1。先建一次本地库表：

```bash
pnpm db:migrate:local
```

`pnpm dev` 和 `pnpm preview` 都跑在本地 Worker 里。`BETTER_AUTH_SECRET` **只从 `.dev.vars` 读**，不读 `.env.local`。把密钥写进 `.env.local` 时，`pnpm preview` 会报「缺少 BETTER_AUTH_SECRET」。

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 示例（文件已被 gitignore，不要提交）：

```bash
# .dev.vars
BETTER_AUTH_SECRET=换成 openssl rand -base64 32 的结果
```

`pnpm dev` 没写这份文件时，会用一个写死的开发用密钥，不要把它带到生产。`pnpm preview` 没有这个兜底，必须在 `.dev.vars` 里提供 `BETTER_AUTH_SECRET`。改了 `.dev.vars` 后要先 `pnpm build` 再 `pnpm preview` 才会生效（preview 用的是构建产物）；日常开发用 `pnpm dev` 会直接读 `.dev.vars`。

```bash
pnpm build    # 生产构建
pnpm preview  # 预览构建结果
pnpm test     # 状态推导 / 食谱解析 / 清单差额单测
```

启动时不会写入示例数据。要看闭环示例，到设置里手动载入；没改过的示例也可以在那里清掉。登录后，这些固定编号的示例不会自动上传到 D1；点「清除示例数据」会软删除并同步，云端不会再把它们拉回来。

粘贴录入走服务端 `POST /api/parse-recipe`（应用内的 `parsePastedRecipe` 走同一套解析）。页面请求换行 JSON 流，用来显示「正在搜索… / 正在读取某站…」；不带这个 Accept 时仍一次返回食谱 JSON。食材自动关联走 `POST /api/resolve-ingredients` / `resolveIngredients`。计划页右上角闪星图标进入「AI 排几天」独立页，走 `POST /api/plan-draft` / `generateMealPlanDraft`，只从已有食谱里挑，人确认后才写入。本地/开发把 `DEEPSEEK_API_KEY` 写进 **`.env.local`**（已 gitignore）才走 DeepSeek；可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。没有 key 或 AI 失败时：完整食谱文字按规则回退，只贴链接或菜名会提示改贴文字；关联按规则回退，排餐则按临期库存 + 常做 + 荤素汤主食出规则草稿。密钥只在服务端读取，不会进浏览器包。

粘贴框也可以贴链接、一段夹着链接的分享文案，或只说菜名（例如「帮我找个红烧肉的做法」）。有 DeepSeek key 时，模型按提示词决定要不要用两个工具：`fetch_page` 抓取公开网页（优先 schema.org Recipe 的 JSON-LD，否则用去掉脚本和导航的正文；有超时、大小上限，并拒绝内网和本机地址），`web_search` 搜索标题、URL 和摘要。搜索默认用 Tavily，把 `TAVILY_API_KEY` 写进 `.dev.vars`（`pnpm dev` / `pnpm preview`）或 `.env.local`。也可以改用 Brave 的 `BRAVE_SEARCH_API_KEY`；两个都有时用 Tavily。都没有时不向模型提供搜索。确认后才入库，并在食谱详情用一行小字显示来源页面。

## 这一期有什么

- TanStack Start + 指定 shadcn preset 脚手架
- IndexedDB 六张表的 CRUD 骨架：ingredients、inventory_items、recipes、recipe_items、plan_entries、shopping_items
- 底部 Tab：库存 / 食谱 / 计划 / 清单；做菜页单独路由
- 粘贴文本、链接或菜名 → 服务端 DeepSeek 抽出（可搜索、可抓取公开食谱页；无 key / 超时 / 坏 JSON 时，完整文字走规则/mock，链接和菜名请改贴文字）→ 人工校对后入库。校对页和食谱编辑都能加减改用料。保存时走 `resolveIngredients` 自动关联或建食材档案，只有真正拿不准才问一句。计划里的菜改用料后会重算清单。从链接导入的会记下来源 URL
- PWA manifest + 基础 Service Worker，方便以后离线看清单和步骤
- 清单按当前计划自动重算（计划/库存/入库/做菜扣库存/改食谱用料后）；也可点「立即重算」。数量是还差多少，入库前可改，同单位加到原库存。差额只有够 / 不够 / 不确定，只比同单位
- 加入库存、清单入库也走同一套解析：写下名字就会自动关联或建档案，只有拿不准才问一句；入库后回填食谱里还没关联的同名食材。过期日按分类默认保质期建议，过期可一键清掉。库存列表仍按临期优先，可用「全部 / 肉 / 菜 / 干货 / 调味」筛选。食材档案在库存页「更多」里，给要改别名或默认保质期的人用
- iOS Safari 不支持系统安装横幅，会在未装到主屏幕、也没刚关掉时给一条软提示：分享 →「添加到主屏幕」。Android 若浏览器抛出 `beforeinstallprompt` 则给同样口气的安装条。不打断现有 manifest / Service Worker
- 库存页「更多 → 设置」：邮箱密码注册、登录、退出；登录后和 D1 双向同步。打开、回到前台（含 iOS PWA 的 pageshow）或网络恢复时会拉一次，前台大约每 30 秒再拉一次，后台不拉。设置里显示上次同步时间，「立即同步」只是备用。同一页可以载入或清除示例数据。浅色/深色一键切换（没选过跟系统，选过写入 localStorage，给 `html` 加 `dark` class）；JSON 备份可导出全部 IndexedDB 表，导入前确认，整份替换并提示会丢掉当前数据
- 计划页右上角闪星图标进入「AI 排几天」：先看/改规则再出草稿。可改天数（当前窗口或 3/5/7）、每天几道、只填空天或可换还没做的、四条固定优先级（临期/常做/荤素汤主食/少重复），以及额外要求（如「少吃辣」）。上次规则记在 localStorage。只从已有食谱挑，不新编菜。默认只填空天；要换掉还没做的需再点头。确认「写入计划」后才生成 `plan_entries` 并重算清单
- 食谱可钉「常做」置顶，并用固定标签（荤菜 / 素菜 / 汤羹 / 主食，可多选）筛选。详情、编辑、粘贴校对都能改。旧库启动时补默认字段；备份 schema v2，仍能导入 v1

## Cloudflare Workers

适配 [TanStack Start + Cloudflare Workers](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)。构建 `pnpm run build`。Git 连接的 Workers Builds 只构建 `main`。**运行时 Secret 不会跟着构建变量进去。**

Workers Builds 的 **Deploy command** 改成：

```bash
npx wrangler d1 migrations apply cook-buddy --remote && npx wrangler deploy
```

本地等价命令是 `pnpm run deploy`（先对远端补跑还没执行的 migration，再部署）。这样推 `main` 会自动建上新表，不用再单独手动 migrate。

### 上线前要在 Cloudflare 手动做的事

1. 创建数据库（名字和 `wrangler.jsonc` 里的 `database_name` 一致）：

   ```bash
   npx wrangler d1 create cook-buddy
   ```

2. 把命令输出的 `database_id` 填进 `wrangler.jsonc` 的 `d1_databases[0].database_id`。这个仓库已经填了 cook-buddy 的 id `e34feebe-4d40-4430-b92d-3d8f538cbc6e`。如果你另建了一个库，换成那个 id。

3. 远端 migration 由上面的 Deploy command 在推 `main` 时自动执行（只跑还没执行过的）。本地开发仍要自己跑一次：

   ```bash
   pnpm db:migrate:local
   ```

   数据在 `.wrangler/`。不经过那条 Deploy command、只跑 `wrangler deploy` 时，才需要再手动 `pnpm db:migrate:remote`。

4. 在 Cloudflare 控制台给这个 Worker 配运行时 Secret，不要配成构建变量（Build variables），也不要写进 `wrangler.jsonc`：

   **Workers → 你的 Worker → Settings → Runtime variables and secrets → Add → Type: Secret**

   - `BETTER_AUTH_SECRET`：会话签名密钥。生产用 `openssl rand -base64 32` 另生成一串，不要复用 `.dev.vars` 里的本地值。
   - `DEEPSEEK_API_KEY`：可选，粘贴录入 / 食材关联 / AI 排餐草稿才需要。
   - `TAVILY_API_KEY`：可选。粘贴链接或只说菜名时，DeepSeek 用它搜索食谱来源。没有这个 key、也没有 `BRAVE_SEARCH_API_KEY` 时，不向模型提供搜索。

   可选的纯文本运行时变量（仍不是构建变量）：`BETTER_AUTH_URL`（对外 origin，例如 `https://cook-buddy.example.com`，一般能从请求推断，不必设）、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。

   用命令行也可以：`npx wrangler secret put BETTER_AUTH_SECRET`（这会立刻发一版）。不要把密钥值写进仓库。

登录后，菜谱、库存、计划、清单、食材档案和替代选择按账号存在 D1，每条用 `updatedAt` 和软删除做最后写入胜出。未登录不访问这些接口。

## 刻意不做

营养热量、社交菜谱广场、超市配送。邮件验证和找回密码只留了回调，还没接邮件服务。AI 不自动写计划，只出草稿等人确认。差额仍是「够 / 不够 / 不确定」。基准库或这种食材自己记住的单位才会换算成记账单位，约数会标出来，换不了的保留原单位并标注。保存前先对到家里的库存。也不在排餐流程里用 AI 新建食谱（粘贴录入已有）。

### 账号同步的已知限制

- 密码用 Web Crypto PBKDF2-SHA256、20000 次。Better Auth 默认的纯 JS scrypt 在 Workers 上容易超过 Free 计划 10ms CPU。迭代次数写在哈希里，以后可以调高，旧密码仍能校验。
- 合并看客户端写入的 `updatedAt`，设备时钟差很多时，较晚的那一边会赢。
- 同一浏览器换账号时，会先清掉本机库再拉新账号的云端数据。前一个账号还没同步上去的修改会留在本机丢失（已经同步过的仍在那个账号的云端）。
- 导入 JSON 备份只替换本机。登录状态下随后同步是按条合并，云端多出来的记录还会回来，不会因为这份备份被删掉。
- 离线照常改本机。网络恢复、再次打开或回到前台时会自动合并。设置里的「立即同步」只是备用。没有多端实时推送。
- 没改过的示例数据留在本机，不上传。清除示例会软删除并同步；改过的示例食材、分类和大类会按 `updatedAt` 跟别的记录一起合并。
- Deploy command 如果没带 `migrations apply`，推 `main` 不会建新表，注册和同步会失败。补上那条命令，或手动 `pnpm db:migrate:remote`。
