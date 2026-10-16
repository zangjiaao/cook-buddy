import { describe, expect, test, vi } from "vitest"
import { fetchRecipePage } from "@/lib/ai/fetch-page"

const JSON_LD = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [{
    "@type": "Recipe",
    "name": "红烧肉",
    "recipeYield": "4 servings",
    "totalTime": "PT1H30M",
    "recipeIngredient": ["五花肉 500克", "冰糖 20克"],
    "recipeInstructions": [
      {"@type": "HowToStep", "text": "肉焯水"},
      {"@type": "HowToSection", "itemListElement": [{"@type": "HowToStep", "text": "炒糖色"}]}
    ]
  }]
}
</script>
</head><body><nav>首页导航不应出现</nav><p>广告</p></body></html>`

const PLAIN = `<!doctype html><html><body>
<nav>顶部导航</nav>
<script>secretToken</script>
<style>.ad{color:red}</style>
<article>
<h1>番茄炒蛋</h1>
<p>番茄 2 个，鸡蛋 3 个。热锅先炒蛋，再下番茄，盐少许，炒到出汁就起锅。</p>
</article>
</body></html>`

function htmlResponse(
  html: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  })
}

describe("fetchRecipePage", () => {
  test("优先返回 schema.org Recipe JSON-LD", async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      htmlResponse(JSON_LD)
    )
    const result = await fetchRecipePage(
      "https://recipes.example/hongshaorou",
      {
        fetchFn: fetchFn as typeof fetch,
      }
    )
    expect(result).toMatchObject({
      ok: true,
      kind: "jsonld",
      url: "https://recipes.example/hongshaorou",
      recipe: {
        name: "红烧肉",
        servings: 4,
        minutes: 90,
        recipeIngredient: ["五花肉 500克", "冰糖 20克"],
        recipeInstructions: ["肉焯水", "炒糖色"],
      },
    })
    expect(JSON.stringify(result)).not.toContain("首页导航")
    const init = fetchFn.mock.calls[0][1]
    if (!init) throw new Error("missing init")
    expect(init.redirect).toBe("manual")
    expect(
      String((init.headers as Record<string, string>)["User-Agent"])
    ).toContain("Chrome")
  })

  test("没有 JSON-LD 时返回去掉脚本和导航的正文", async () => {
    const fetchFn = vi.fn(async () => htmlResponse(PLAIN))
    const result = await fetchRecipePage("https://recipes.example/egg", {
      fetchFn: fetchFn,
    })
    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== "text") throw new Error("expected text")
    expect(result.text).toContain("番茄炒蛋")
    expect(result.text).toContain("热锅先炒蛋")
    expect(result.text).not.toContain("顶部导航")
    expect(result.text).not.toContain("secretToken")
    expect(result.text).not.toContain(".ad")
  })

  test("抓取失败或超时给出错误，不抛出", async () => {
    const httpFail = await fetchRecipePage("https://recipes.example/missing", {
      fetchFn: vi.fn(async () => htmlResponse("nope", 503)),
    })
    expect(httpFail).toMatchObject({ ok: false, error: "页面返回 503" })

    const network = await fetchRecipePage("https://recipes.example/down", {
      fetchFn: vi.fn(async () => {
        throw new Error("boom")
      }),
    })
    expect(network).toMatchObject({ ok: false, error: "抓取失败" })

    const timedOut = await fetchRecipePage("https://recipes.example/slow", {
      timeoutMs: 10,
      fetchFn: vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted")
            error.name = "AbortError"
            reject(error)
          })
        })
      }) as typeof fetch,
    })
    expect(timedOut).toMatchObject({ ok: false, error: "抓取超时" })
  })

  test("拒绝内网、本机和跳到内网的重定向", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "https://recipes.example/jump") {
        return htmlResponse("", 302, { location: "http://127.0.0.1/secret" })
      }
      return htmlResponse(PLAIN)
    })
    const blocked = [
      "http://127.0.0.1/admin",
      "http://localhost/x",
      "http://10.1.2.3/",
      "http://192.168.1.5/",
      "http://172.16.5.5/",
      "http://169.254.169.254/latest",
      "http://[::1]/",
      "http://2130706433/",
      "file:///etc/passwd",
    ]
    for (const url of blocked) {
      const result = await fetchRecipePage(url, {
        fetchFn: fetchFn as typeof fetch,
      })
      expect(result.ok, url).toBe(false)
    }
    expect(fetchFn).not.toHaveBeenCalled()

    const redirected = await fetchRecipePage("https://recipes.example/jump", {
      fetchFn: fetchFn as typeof fetch,
    })
    expect(redirected.ok).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test("正文超过大小上限时截断，不读入尾部", async () => {
    const head = JSON_LD.replace("</body></html>", "")
    const body = new TextEncoder().encode(
      `${head}${"TAILMARKER".repeat(50)}</body></html>`
    )
    const fetchFn = vi.fn(async () => {
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    })
    const result = await fetchRecipePage("https://recipes.example/big", {
      fetchFn: fetchFn,
      maxBytes: new TextEncoder().encode(head).byteLength,
    })
    expect(JSON.stringify(result)).not.toContain("TAILMARKER")
    expect(result).toMatchObject({ ok: true, kind: "jsonld" })
  })
})
