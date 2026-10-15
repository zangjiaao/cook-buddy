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

首次打开会写入一份可点通闭环的示例数据（临期青菜、两道菜、三天计划和一份够/不够/不确定清单）。

粘贴录入走服务端 `POST /api/parse-recipe`（应用内也通过同名 server function 调用）。食材自动关联走 `POST /api/resolve-ingredients` / `resolveIngredients`。计划页右上角闪星图标进入「AI 排几天」独立页，走 `POST /api/plan-draft` / `generateMealPlanDraft`，只从已有食谱里挑，人确认后才写入。本地/开发把 `DEEPSEEK_API_KEY` 写进 **`.env.local`**（已 gitignore）才走 DeepSeek；可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。没有 key 或 AI 失败时：粘贴/关联按规则回退，排餐则按临期库存 + 常做 + 荤素汤主食出规则草稿。密钥只在服务端读取，不会进浏览器包。

## 这一期有什么

- TanStack Start + 指定 shadcn preset 脚手架
- IndexedDB 六张表的 CRUD 骨架：ingredients、inventory_items、recipes、recipe_items、plan_entries、shopping_items
- 底部 Tab：库存 / 食谱 / 计划 / 清单；做菜页单独路由
- 粘贴文本 → 服务端 DeepSeek 抽出（无 key / 超时 / 坏 JSON 则规则/mock）→ 人工校对后入库。校对页和食谱编辑都能加减改用料。保存时走 `resolveIngredients` 自动关联或建食材档案，只有真正拿不准才问一句。计划里的菜改用料后会重算清单
- PWA manifest + 基础 Service Worker，方便以后离线看清单和步骤
- 清单按当前计划自动重算（计划/库存/入库/做菜扣库存/改食谱用料后）；也可点「立即重算」。数量是还差多少，入库前可改，同单位加到原库存。差额只有够 / 不够 / 不确定，只比同单位
- 加入库存、清单入库也走同一套解析：写下名字就会自动关联或建档案，只有拿不准才问一句；入库后回填食谱里还没关联的同名食材。过期日按分类默认保质期建议，过期可一键清掉。库存列表仍按临期优先，可用「全部 / 肉 / 菜 / 干货 / 调味」筛选。食材档案在库存页「更多」里，给要改别名或默认保质期的人用
- iOS Safari 不支持系统安装横幅，会在未装到主屏幕、也没刚关掉时给一条软提示：分享 →「添加到主屏幕」。Android 若浏览器抛出 `beforeinstallprompt` 则给同样口气的安装条。不打断现有 manifest / Service Worker
- 库存页「更多 → 设置」：邮箱密码注册、登录、退出；登录后和 D1 双向同步。打开、回到前台（含 iOS PWA 的 pageshow）或网络恢复时会拉一次，前台大约每 30 秒再拉一次，后台不拉。设置里显示上次同步时间，「立即同步」只是备用。浅色/深色一键切换（没选过跟系统，选过写入 localStorage，给 `html` 加 `dark` class）；JSON 备份可导出全部 IndexedDB 表，导入前确认，整份替换并提示会丢掉当前数据
- 计划页右上角闪星图标进入「AI 排几天」：先看/改规则再出草稿。可改天数（当前窗口或 3/5/7）、每天几道、只填空天或可换还没做的、四条固定优先级（临期/常做/荤素汤主食/少重复），以及额外要求（如「少吃辣」）。上次规则记在 localStorage。只从已有食谱挑，不新编菜。默认只填空天；要换掉还没做的需再点头。确认「写入计划」后才生成 `plan_entries` 并重算清单
- 食谱可钉「常做」置顶，并用固定标签（荤菜 / 素菜 / 汤羹 / 主食，可多选）筛选。详情、编辑、粘贴校对都能改。旧库启动时补默认字段；备份 schema v2，仍能导入 v1

## Cloudflare Workers

适配 [TanStack Start + Cloudflare Workers](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)。构建 `pnpm run build`，部署 `npx wrangler deploy`（或 `pnpm run deploy`）。Git 连接的 Workers Builds 只构建 `main`，同样先 build 再 wrangler deploy。**构建流水线不会自动跑 D1 migration，也不会带上运行时 Secret。**

### 上线前要在 Cloudflare 手动做的事

1. 创建数据库（名字和 `wrangler.jsonc` 里的 `database_name` 一致）：

   ```bash
   npx wrangler d1 create cook-buddy
   ```

2. 把命令输出的 `database_id` 填进 `wrangler.jsonc` 的 `d1_databases[0].database_id`。仓库里现在是占位 UUID `00000000-0000-4000-8000-000000000000`，不换成真实 id 就绑不上你的库。

3. 对远端执行 migration（认证表 + 六张业务表）：

   ```bash
   pnpm db:migrate:remote
   # 等价于 npx wrangler d1 migrations apply cook-buddy --remote
   ```

   本地开发用 `pnpm db:migrate:local`（miniflare / wrangler 的本地 D1，数据在 `.wrangler/`）。

4. 在 Cloudflare 控制台给这个 Worker 配运行时 Secret，不要配成构建变量（Build variables），也不要写进 `wrangler.jsonc`：

   **Workers → 你的 Worker → Settings → Runtime variables and secrets → Add → Type: Secret**

   - `BETTER_AUTH_SECRET`：会话签名密钥。生产用 `openssl rand -base64 32` 另生成一串，不要复用 `.dev.vars` 里的本地值。
   - `DEEPSEEK_API_KEY`：可选，粘贴录入 / 食材关联 / AI 排餐草稿才需要。

   可选的纯文本运行时变量（仍不是构建变量）：`BETTER_AUTH_URL`（对外 origin，例如 `https://cook-buddy.example.com`，一般能从请求推断，不必设）、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。

   用命令行也可以：`npx wrangler secret put BETTER_AUTH_SECRET`（这会立刻发一版）。不要把密钥值写进仓库。

登录后，菜谱、库存、计划、清单、食材档案和替代选择按账号存在 D1，每条用 `updatedAt` 和软删除做最后写入胜出。未登录不访问这些接口。

## 刻意不做

营养热量、社交菜谱广场、超市配送。邮件验证和找回密码只留了回调，还没接邮件服务。AI 不自动写计划，只出草稿等人确认。差额只用「够 / 不够 / 不确定」，不做克数换算引擎。也不在排餐流程里用 AI 新建食谱（粘贴录入已有）。

### 账号同步的已知限制

- 密码用 Web Crypto PBKDF2-SHA256、20000 次。Better Auth 默认的纯 JS scrypt 在 Workers 上容易超过 Free 计划 10ms CPU。迭代次数写在哈希里，以后可以调高，旧密码仍能校验。
- 合并看客户端写入的 `updatedAt`，设备时钟差很多时，较晚的那一边会赢。
- 同一浏览器换账号时，会先清掉本机库再拉新账号的云端数据。前一个账号还没同步上去的修改会留在本机丢失（已经同步过的仍在那个账号的云端）。
- 导入 JSON 备份只替换本机。登录状态下随后同步是按条合并，云端多出来的记录还会回来，不会因为这份备份被删掉。
- 离线照常改本机。网络恢复、再次打开或回到前台时会自动合并。设置里的「立即同步」只是备用。没有多端实时推送。
- Workers Builds 不会自动 `migrations apply`。`main` 上的代码如果先部署、表还没建，注册和同步会失败，补跑远端 migration 即可。
