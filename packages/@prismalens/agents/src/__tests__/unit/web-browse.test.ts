import { describe, it, expect, vi, beforeEach } from "vitest"
import { createWebBrowseTool } from "../../tools/web-browse.js"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

function htmlResponse(html: string, contentType = "text/html") {
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": contentType },
  })
}

function redirectResponse(location: string, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: location },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("web_browse", () => {
  describe("HTML extraction", () => {
    it("extracts title and text from simple HTML", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        htmlResponse(
          "<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>",
        ),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/page" }),
      )
      expect(result.title).toBe("Test Page")
      expect(result.content).toContain("Hello world")
      expect(result.url).toBe("https://example.com/page")
    })

    it("strips noise elements (nav, footer, script, style)", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        htmlResponse(`
          <html><head><title>T</title></head><body>
            <nav>Navigation links</nav>
            <script>var x = 1;</script>
            <style>.foo { color: red; }</style>
            <main><p>Main content</p></main>
            <footer>Footer info</footer>
          </body></html>
        `),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com" }),
      )
      expect(result.content).toContain("Main content")
      expect(result.content).not.toContain("Navigation links")
      expect(result.content).not.toContain("var x = 1")
      expect(result.content).not.toContain("Footer info")
      expect(result.content).not.toContain("color: red")
    })

    it("uses CSS selector when provided", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        htmlResponse(`
          <html><head><title>T</title></head><body>
            <div class="sidebar">Sidebar</div>
            <article>Article content here</article>
            <div class="other">Other stuff</div>
          </body></html>
        `),
      )

      const result = JSON.parse(
        await tool.invoke({
          url: "https://example.com",
          selector: "article",
        }),
      )
      expect(result.content).toBe("Article content here")
    })

    it("returns error when selector matches nothing", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        htmlResponse(
          "<html><head><title>T</title></head><body><p>Text</p></body></html>",
        ),
      )

      const result = JSON.parse(
        await tool.invoke({
          url: "https://example.com",
          selector: ".nonexistent",
        }),
      )
      expect(result.error).toContain("matched no elements")
    })
  })

  describe("content type handling", () => {
    it("handles text/plain responses", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        new Response("Plain text content", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/robots.txt" }),
      )
      expect(result.content).toBe("Plain text content")
      expect(result.title).toBe("")
    })

    it("rejects unsupported content types", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        new Response("binary", {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/file.pdf" }),
      )
      expect(result.error).toContain("Unsupported content type")
    })
  })

  describe("domain filtering", () => {
    it("allows domains in allowedDomains", async () => {
      const tool = createWebBrowseTool({
        allowedDomains: ["docs.example.com"],
      })
      mockFetch.mockResolvedValue(
        htmlResponse("<html><head><title>T</title></head><body>OK</body></html>"),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://docs.example.com/page" }),
      )
      expect(result.content).toContain("OK")
    })

    it("blocks domains not in allowedDomains", async () => {
      const tool = createWebBrowseTool({
        allowedDomains: ["docs.example.com"],
      })

      const result = JSON.parse(
        await tool.invoke({ url: "https://evil.com/page" }),
      )
      expect(result.error).toContain("not allowed")
    })

    it("blocks domains in blockedDomains", async () => {
      const tool = createWebBrowseTool({
        blockedDomains: ["evil.com"],
      })

      const result = JSON.parse(
        await tool.invoke({ url: "https://evil.com/page" }),
      )
      expect(result.error).toContain("not allowed")
    })
  })

  describe("SSRF prevention", () => {
    it("blocks localhost URLs", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "http://localhost/admin" }),
      )
      expect(result.error).toContain("not allowed")
    })

    it("blocks 127.0.0.1", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "http://127.0.0.1/admin" }),
      )
      expect(result.error).toContain("not allowed")
    })

    it("blocks AWS IMDS endpoint (169.254.169.254)", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "http://169.254.169.254/latest/meta-data/" }),
      )
      expect(result.error).toContain("not allowed")
    })

    it("blocks private network IPs (10.x.x.x)", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "http://10.0.0.1/internal" }),
      )
      expect(result.error).toContain("not allowed")
    })

    it("blocks private network IPs (192.168.x.x)", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "http://192.168.1.1/" }),
      )
      expect(result.error).toContain("not allowed")
    })

    it("rejects file: protocol", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "file:///etc/passwd" }),
      )
      expect(result.error).toContain("Unsupported protocol")
    })

    it("rejects data: protocol", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({ url: "data:text/html,<h1>evil</h1>" }),
      )
      expect(result.error).toContain("Unsupported protocol")
    })

    it("blocks redirects to private IPs", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        redirectResponse("http://169.254.169.254/latest/meta-data/"),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/redir" }),
      )
      expect(result.error).toContain("blocked domain")
    })

    it("blocks redirects to disallowed domains", async () => {
      const tool = createWebBrowseTool({
        allowedDomains: ["docs.example.com"],
      })
      mockFetch.mockResolvedValue(
        redirectResponse("https://evil.com/page"),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://docs.example.com/redir" }),
      )
      expect(result.error).toContain("blocked domain")
    })

    it("follows redirects to allowed domains", async () => {
      const tool = createWebBrowseTool()
      mockFetch
        .mockResolvedValueOnce(redirectResponse("https://example.com/final"))
        .mockResolvedValueOnce(
          htmlResponse("<html><head><title>T</title></head><body>Redirected OK</body></html>"),
        )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/start" }),
      )
      expect(result.content).toContain("Redirected OK")
    })
  })

  describe("selector validation", () => {
    it("rejects complex selectors with parentheses", async () => {
      const tool = createWebBrowseTool()

      const result = JSON.parse(
        await tool.invoke({
          url: "https://example.com",
          selector: ":nth-child(1)",
        }),
      )
      expect(result.error).toContain("Invalid selector")
    })

    it("allows simple element selectors", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        htmlResponse("<html><head><title>T</title></head><body><main>Content</main></body></html>"),
      )

      const result = JSON.parse(
        await tool.invoke({
          url: "https://example.com",
          selector: "main",
        }),
      )
      expect(result.content).toBe("Content")
    })

    it("allows class selectors", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        htmlResponse(
          '<html><head><title>T</title></head><body><div class="content">Text</div></body></html>',
        ),
      )

      const result = JSON.parse(
        await tool.invoke({
          url: "https://example.com",
          selector: ".content",
        }),
      )
      expect(result.content).toBe("Text")
    })
  })

  describe("budget", () => {
    it("allows requests within budget", async () => {
      const tool = createWebBrowseTool({ maxUses: 2 })
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          htmlResponse("<html><head><title>T</title></head><body>OK</body></html>"),
        ),
      )

      const r1 = JSON.parse(
        await tool.invoke({ url: "https://example.com/1" }),
      )
      expect(r1.content).toBeDefined()

      const r2 = JSON.parse(
        await tool.invoke({ url: "https://example.com/2" }),
      )
      expect(r2.content).toBeDefined()
    })

    it("rejects requests when budget exhausted", async () => {
      const tool = createWebBrowseTool({ maxUses: 1 })
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          htmlResponse("<html><head><title>T</title></head><body>OK</body></html>"),
        ),
      )

      await tool.invoke({ url: "https://example.com/1" })

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/2" }),
      )
      expect(result.error).toContain("budget exhausted")
    })

    it("does not consume budget on validation failures", async () => {
      const tool = createWebBrowseTool({
        maxUses: 1,
        blockedDomains: ["evil.com"],
      })
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          htmlResponse("<html><head><title>T</title></head><body>OK</body></html>"),
        ),
      )

      // Blocked domain — does NOT consume budget
      await tool.invoke({ url: "https://evil.com/page" })

      // Valid call should still work
      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/page" }),
      )
      expect(result.content).toContain("OK")
    })
  })

  describe("truncation", () => {
    it("truncates content exceeding maxContentSize", async () => {
      const tool = createWebBrowseTool({ maxContentSize: 50 })
      const longText = "x".repeat(200)
      mockFetch.mockResolvedValue(
        htmlResponse(
          `<html><head><title>T</title></head><body><p>${longText}</p></body></html>`,
        ),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com" }),
      )
      expect(result.content.length).toBeLessThan(200)
      expect(result.content).toContain("truncated")
    })
  })

  describe("error handling", () => {
    it("returns error on HTTP error response", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockResolvedValue(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      )

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com/missing" }),
      )
      expect(result.error).toContain("404")
    })

    it("rejects invalid URL via schema validation", async () => {
      const tool = createWebBrowseTool()

      await expect(
        tool.invoke({ url: "not-a-url" }),
      ).rejects.toThrow()
    })

    it("returns error on fetch failure", async () => {
      const tool = createWebBrowseTool()
      mockFetch.mockRejectedValue(new Error("Network error"))

      const result = JSON.parse(
        await tool.invoke({ url: "https://example.com" }),
      )
      expect(result.error).toContain("Network error")
    })
  })
})
