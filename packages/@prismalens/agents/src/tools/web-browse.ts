/**
 * web_browse tool — fetch a URL and extract readable text using cheerio.
 *
 * No LLM needed for summarization — the calling agent IS the LLM.
 * Returns page title + extracted text with noise stripped.
 *
 * Always available (uses Node.js fetch, no external API key required).
 *
 * Security:
 *  - Protocol restricted to https/http only (no file:, data:, ftp:)
 *  - Private/loopback IPs always blocked via isDomainAllowed()
 *  - Redirects handled manually with domain re-validation per hop
 *  - CSS selector validated against safe pattern
 */

import { z } from "zod"
import { StructuredTool } from "@langchain/core/tools"
import * as cheerio from "cheerio"
import { getGraphConfig } from "../config/env.js"
import { isDomainAllowed, type DomainFilter } from "./domain-filter.js"

// ── Options ──────────────────────────────────────────────────────────

export interface WebBrowseToolOptions extends DomainFilter {
  /** Request budget (0 = unlimited, default 0) */
  maxUses?: number
  /** Max chars in extracted text (default 50_000) */
  maxContentSize?: number
  /** Fetch timeout in ms (default 30_000) */
  timeoutMs?: number
  /** Custom User-Agent header */
  userAgent?: string
}

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_USER_AGENT = "PrismaLens-Agent/1.0"

/** Resolve web browse defaults from env config */
function getWebBrowseDefaults() {
  const cfg = getGraphConfig()
  return {
    maxContentSize: cfg.PRISMALENS_WEB_BROWSE_MAX_CONTENT_SIZE,
    timeoutMs: cfg.PRISMALENS_WEB_BROWSE_TIMEOUT_MS,
    maxRedirects: cfg.PRISMALENS_WEB_BROWSE_MAX_REDIRECTS,
  }
}

/** Allowed URL protocols */
const ALLOWED_PROTOCOLS = new Set(["https:", "http:"])

/**
 * Safe CSS selector pattern — allows element names, classes, IDs,
 * attributes, combinators, and pseudo-classes. Rejects anything
 * with parentheses (prevents :nth-child abuse) or exotic syntax.
 */
const SAFE_SELECTOR_RE = /^[a-zA-Z*.#\[][a-zA-Z0-9\-_#. >+~:[\]="']*$/

/** Selectors for noise elements stripped before text extraction */
const NOISE_SELECTORS = [
  "script", "style", "noscript",
  "nav", "footer", "header",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  ".sidebar", ".menu", ".ad",
  "iframe", "svg",
]

// ── Schema ───────────────────────────────────────────────────────────

const WebBrowseSchema = z.object({
  url: z
    .string()
    .url()
    .describe("Absolute URL to fetch and read (e.g., 'https://docs.aws.com/...')"),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector to extract specific content (e.g., 'article', 'main', '.content'). " +
      "Defaults to 'body'. Use when the page has a clear content container.",
    ),
})

type WebBrowseInput = z.infer<typeof WebBrowseSchema>

// ── Tool ─────────────────────────────────────────────────────────────

class WebBrowseTool extends StructuredTool {
  name = "web_browse"
  description: string
  schema = WebBrowseSchema

  private filter: DomainFilter
  private maxUses: number
  private useCount = 0
  private maxContentSize: number
  private timeoutMs: number
  private userAgent: string

  private maxRedirects: number

  constructor(options: WebBrowseToolOptions) {
    super()
    const defaults = getWebBrowseDefaults()
    this.filter = {
      allowedDomains: options.allowedDomains,
      blockedDomains: options.blockedDomains,
    }
    this.maxUses = options.maxUses ?? 0
    this.maxContentSize = options.maxContentSize ?? defaults.maxContentSize
    this.timeoutMs = options.timeoutMs ?? defaults.timeoutMs
    this.maxRedirects = defaults.maxRedirects
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT

    const domainNote = options.allowedDomains
      ? `Allowed domains: ${options.allowedDomains.join(", ")}. `
      : options.blockedDomains
        ? `Blocked domains: ${options.blockedDomains.join(", ")}. `
        : ""

    this.description =
      `Fetch a web page and extract its readable text content. ` +
      `Use this to read documentation, Stack Overflow answers, blog posts, or any public web page. ` +
      `${domainNote}` +
      `Returns the page title and extracted text (HTML tags stripped, noise removed). ` +
      `No authentication — for authenticated API calls, use http_request instead.`
  }

  async _call(input: WebBrowseInput): Promise<string> {
    // 1. Parse and validate URL
    let parsed: URL
    try {
      parsed = new URL(input.url)
    } catch {
      return JSON.stringify({ error: `Invalid URL: ${input.url}` })
    }

    // 2. Protocol enforcement — https/http only (no file:, data:, ftp:)
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return JSON.stringify({
        error: `Unsupported protocol: ${parsed.protocol}. Only https and http are allowed.`,
      })
    }

    // 3. Domain validation (includes private IP blocking)
    if (!isDomainAllowed(parsed.hostname, this.filter)) {
      return JSON.stringify({
        error: `Domain "${parsed.hostname}" is not allowed.`,
      })
    }

    // 4. Selector validation
    const selector = input.selector ?? "body"
    if (input.selector && !SAFE_SELECTOR_RE.test(input.selector)) {
      return JSON.stringify({
        error: `Invalid selector: only simple CSS selectors are allowed (elements, classes, IDs, attributes).`,
      })
    }

    // 5. Budget check — after validation, before network call
    if (this.maxUses > 0 && this.useCount >= this.maxUses) {
      return JSON.stringify({
        error: `Browse budget exhausted (${this.maxUses} pages). No more pages can be fetched.`,
      })
    }
    this.useCount++

    try {
      // 6. Fetch with manual redirect handling (re-validate each hop)
      const response = await this.fetchWithRedirects(parsed.toString())

      if (!response.ok) {
        return JSON.stringify({
          error: `HTTP ${response.status} ${response.statusText}`,
          url: input.url,
        })
      }

      // 7. Check content type
      const contentType = response.headers.get("content-type") ?? ""
      const text = await response.text()

      if (contentType.includes("text/plain")) {
        const content =
          text.length > this.maxContentSize
            ? text.slice(0, this.maxContentSize) + "\n...[truncated]"
            : text
        return JSON.stringify({ url: input.url, title: "", content })
      }

      if (!contentType.includes("text/html")) {
        return JSON.stringify({
          error: `Unsupported content type: ${contentType}. Only text/html and text/plain are supported.`,
          url: input.url,
        })
      }

      // 8. Parse HTML with cheerio
      const $ = cheerio.load(text)

      // 9. Extract title
      const title = $("title").first().text().trim()

      // 10. Remove noise elements
      $(NOISE_SELECTORS.join(", ")).remove()

      // 11. Extract text from selector
      const target = $(selector)

      if (target.length === 0) {
        return JSON.stringify({
          error: `Selector "${selector}" matched no elements on the page.`,
          url: input.url,
          title,
        })
      }

      // 12. Get text content, normalize whitespace
      let content = target
        .text()
        .replace(/\s+/g, " ")
        .replace(/ ([.,;:!?])/g, "$1")
        .trim()

      // 13. Truncate if needed
      if (content.length > this.maxContentSize) {
        content =
          content.slice(0, this.maxContentSize) + "\n...[truncated]"
      }

      return JSON.stringify({ url: input.url, title, content })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify({
        error: `Browse failed: ${message}`,
        url: input.url,
      })
    }
  }

  /**
   * Fetch a URL with manual redirect handling.
   * Each redirect hop is validated against the domain filter.
   */
  private async fetchWithRedirects(url: string): Promise<Response> {
    let currentUrl = url

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const response = await fetch(currentUrl, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html, text/plain, */*",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      })

      // Not a redirect — return the response
      if (response.status < 300 || response.status >= 400) {
        return response
      }

      // Redirect — validate the target
      const location = response.headers.get("location")
      if (!location) {
        return new Response(null, {
          status: 502,
          statusText: "Redirect with no Location header",
        })
      }

      const redirectUrl = new URL(location, currentUrl)

      if (!ALLOWED_PROTOCOLS.has(redirectUrl.protocol)) {
        return new Response(null, {
          status: 502,
          statusText: `Redirect to unsupported protocol: ${redirectUrl.protocol}`,
        })
      }

      if (!isDomainAllowed(redirectUrl.hostname, this.filter)) {
        return new Response(null, {
          status: 502,
          statusText: `Redirect to blocked domain: ${redirectUrl.hostname}`,
        })
      }

      currentUrl = redirectUrl.toString()
    }

    return new Response(null, {
      status: 502,
      statusText: `Too many redirects (>${this.maxRedirects})`,
    })
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createWebBrowseTool(
  options: WebBrowseToolOptions = {},
): StructuredTool {
  return new WebBrowseTool(options)
}
