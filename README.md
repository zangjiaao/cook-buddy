# cook-buddy

帮我烹饪的搭子，除了重复造轮子之外，加一些自己的习惯，这不就是vibe-coding的乐趣吗

中文名：**做饭搭子**。本地优先的做饭闭环 PWA：看库存 → 排这几天吃什么 → 生成菜市场购买清单 → 买回来入库 → 按食谱做并扣库存。

## 本地运行

需要 Node 20+ 和 [pnpm](https://pnpm.io)。

```bash
pnpm install
pnpm dev
```

浏览器打开 http://localhost:3000 。数据存在本机 IndexedDB，无需登录。

```bash
pnpm build    # 生产构建
pnpm preview  # 预览构建结果
pnpm test     # 状态推导 / 食谱解析 / 清单差额单测
```

首次打开会写入一份可点通闭环的示例数据（临期青菜、两道菜、三天计划和一份够/不够/不确定清单）。

## 这一期有什么

- TanStack Start + 指定 shadcn preset 脚手架
- IndexedDB 六张表的 CRUD 骨架：ingredients、inventory_items、recipes、recipe_items、plan_entries、shopping_items
- 底部 Tab：库存 / 食谱 / 计划 / 清单；做菜页单独路由
- 粘贴文本 → 规则/mock 草稿 → 人工校对后入库
- PWA manifest + 基础 Service Worker，方便以后离线看清单和步骤
- 清单按当前计划自动重算（计划/库存/入库/做菜扣库存后）；也可点「立即重算」。数量是还差多少，入库前可改，同单位加到原库存。差额只有够 / 不够 / 不确定，只比同单位
- 库存按食材主数据搜索对齐（模糊匹配 +「就是这个」），过期日按分类默认保质期建议，过期可一键清掉

## 刻意不做

营养热量、社交菜谱广场、多用户同步、智能一周推荐、超市配送。差额只用「够 / 不够 / 不确定」，不做克数换算引擎。
