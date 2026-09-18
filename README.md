# cook-buddy

帮我烹饪的搭子，除了重复造轮子之外，加一些自己的习惯，这不就是vibe-coding的乐趣吗

中文名：**做饭搭子**。本地优先的做饭闭环 PWA：看库存 → 排这几天吃什么 → 生成菜市场购买清单 → 买回来入库 → 按食谱做并扣库存。

## 本地运行

需要 Node 20+ 和 [pnpm](https://pnpm.io)。

```bash
pnpm install
cp .env.example .env.local   # 本地开发把 key 写这里，不要提交
pnpm dev
```

浏览器打开 http://localhost:3000 。数据存在本机 IndexedDB，无需登录。

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
- 库存页「更多 → 设置」：浅色/深色一键切换（没选过跟系统，选过写入 localStorage，给 `html` 加 `dark` class）；JSON 备份可导出全部 IndexedDB 表，导入前确认，整份替换并提示会丢掉当前数据
- 计划页右上角闪星图标进入「AI 排几天」：先看/改规则再出草稿。可改天数（当前窗口或 3/5/7）、每天几道、只填空天或可换还没做的、四条固定优先级（临期/常做/荤素汤主食/少重复），以及额外要求（如「少吃辣」）。上次规则记在 localStorage。只从已有食谱挑，不新编菜。默认只填空天；要换掉还没做的需再点头。确认「写入计划」后才生成 `plan_entries` 并重算清单
- 食谱可钉「常做」置顶，并用固定标签（荤菜 / 素菜 / 汤羹 / 主食，可多选）筛选。详情、编辑、粘贴校对都能改。旧库启动时补默认字段；备份 schema v2，仍能导入 v1

## Cloudflare Workers

适配 [TanStack Start + Cloudflare Workers](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)。构建 `pnpm run build`，部署 `npx wrangler deploy`（或 `pnpm run deploy`）。Git 连接的 Workers Builds 同样先 build 再 wrangler deploy。

在 **Workers / Pages 项目环境变量**（或 `wrangler secret put`）里设置 `DEEPSEEK_API_KEY`；可选 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。不要把真实 key 写进仓库或 `wrangler.jsonc`。本地 `pnpm dev` 仍读 `.env.local`。

IndexedDB 仍在用户浏览器本地，线上部署不会同步库存/计划/清单。不部署时本地 `pnpm build && pnpm preview` 即可。

## 刻意不做

营养热量、社交菜谱广场、多用户同步、超市配送。AI 不自动写计划，只出草稿等人确认。差额只用「够 / 不够 / 不确定」，不做克数换算引擎。也不在排餐流程里用 AI 新建食谱（粘贴录入已有）。
