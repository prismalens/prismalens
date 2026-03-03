import { describe, it, expect, vi, beforeEach } from "vitest"
import { getWorkspacePath, createWorkspaceDir, cleanupWorkspaceDir, injectSpecFiles } from "../../config/workspace.js"
import type { IntegrationWithCredentials } from "../../types/contexts.js"
import { mkdir, cp, rm, writeFile } from "node:fs/promises"

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  cp: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}))

describe("getWorkspacePath", () => {
  it("returns correct path for valid investigationId", () => {
    const path = getWorkspacePath("inv-123")
    expect(path).toContain("prismalens-investigations")
    expect(path).toContain("inv-123")
    expect(path).toContain("workspace")
  })

  it("accepts alphanumeric, dash, and underscore characters", () => {
    expect(() => getWorkspacePath("abc-123_def")).not.toThrow()
    expect(() => getWorkspacePath("ABC")).not.toThrow()
    expect(() => getWorkspacePath("a")).not.toThrow()
  })

  it("rejects path traversal attempts", () => {
    expect(() => getWorkspacePath("../../../etc")).toThrow("Invalid investigationId")
    expect(() => getWorkspacePath("../../")).toThrow("Invalid investigationId")
    expect(() => getWorkspacePath("foo/bar")).toThrow("Invalid investigationId")
    expect(() => getWorkspacePath("foo\\bar")).toThrow("Invalid investigationId")
  })

  it("rejects empty string", () => {
    expect(() => getWorkspacePath("")).toThrow("Invalid investigationId")
  })

  it("rejects special characters", () => {
    expect(() => getWorkspacePath("inv 123")).toThrow("Invalid investigationId")
    expect(() => getWorkspacePath("inv.123")).toThrow("Invalid investigationId")
    expect(() => getWorkspacePath("inv;rm -rf")).toThrow("Invalid investigationId")
  })
})

describe("createWorkspaceDir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates workspace directory with specs subdirectory", async () => {
    const path = await createWorkspaceDir("inv-test")
    expect(path).toContain("inv-test/workspace")
    expect(mkdir).toHaveBeenCalledTimes(1)
    const mkdirCall = vi.mocked(mkdir).mock.calls[0]
    expect(mkdirCall[0]).toContain("specs")
    expect(mkdirCall[1]).toEqual({ recursive: true })
  })

  it("validates investigationId before creating", async () => {
    await expect(createWorkspaceDir("../malicious")).rejects.toThrow("Invalid investigationId")
    expect(mkdir).not.toHaveBeenCalled()
  })
})

describe("cleanupWorkspaceDir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("removes investigation directory", async () => {
    await cleanupWorkspaceDir("inv-test")
    expect(rm).toHaveBeenCalledTimes(1)
    const rmCall = vi.mocked(rm).mock.calls[0]
    expect(rmCall[0]).toContain("inv-test")
    expect(rmCall[1]).toEqual({ recursive: true, force: true })
  })

  it("validates investigationId (prevents path traversal)", async () => {
    await expect(cleanupWorkspaceDir("../../malicious")).rejects.toThrow("Invalid investigationId")
    expect(rm).not.toHaveBeenCalled()
  })

  it("does not throw on rm failure (best effort)", async () => {
    vi.mocked(rm).mockRejectedValue(new Error("ENOENT"))
    await expect(cleanupWorkspaceDir("inv-test")).resolves.toBeUndefined()
  })
})

describe("injectSpecFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("copies bundled spec for enabled integrations (convention fallback)", async () => {
    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "render",
        type: "render",
        enabled: true,
        config: {},
        credentials: { apiKey: "test" },
      },
    ]

    await injectSpecFiles("/tmp/prismalens-investigations/inv-1/workspace", integrations)
    expect(cp).toHaveBeenCalledTimes(1)
    const cpCall = vi.mocked(cp).mock.calls[0]
    expect(cpCall[0]).toContain("render-openapi.json")
    expect(cpCall[1]).toContain("render-openapi.json")
  })

  it("fetches spec from specUrl when provided", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"openapi":"3.0.0"}', { status: 200 }),
    )

    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "custom",
        type: "custom",
        enabled: true,
        config: {},
        credentials: {},
        specUrl: "https://example.com/spec.json",
      },
    ]

    await injectSpecFiles("/tmp/prismalens-investigations/inv-1/workspace", integrations)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/spec.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(cp).not.toHaveBeenCalled()
  })

  it("skips specUrl fetch on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    )

    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "custom",
        type: "custom",
        enabled: true,
        config: {},
        credentials: {},
        specUrl: "https://example.com/bad-spec.json",
      },
    ]

    await injectSpecFiles("/tmp/prismalens-investigations/inv-1/workspace", integrations)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("deduplicates by integration type", async () => {
    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "render-1",
        type: "render",
        enabled: true,
        config: {},
        credentials: { apiKey: "test1" },
      },
      {
        id: "conn-2",
        name: "render-2",
        type: "render",
        enabled: true,
        config: {},
        credentials: { apiKey: "test2" },
      },
    ]

    await injectSpecFiles("/tmp/prismalens-investigations/inv-1/workspace", integrations)
    expect(cp).toHaveBeenCalledTimes(1)
  })

  it("skips disabled integrations", async () => {
    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "render",
        type: "render",
        enabled: false,
        config: {},
        credentials: { apiKey: "test" },
      },
    ]

    await injectSpecFiles("/tmp/prismalens-investigations/inv-1/workspace", integrations)
    expect(cp).not.toHaveBeenCalled()
  })

  it("does not throw on copy failure", async () => {
    vi.mocked(cp).mockRejectedValue(new Error("ENOENT"))

    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "render",
        type: "render",
        enabled: true,
        config: {},
        credentials: { apiKey: "test" },
      },
    ]

    await expect(
      injectSpecFiles("/tmp/prismalens-investigations/inv-1/workspace", integrations),
    ).resolves.toBeUndefined()
  })

  it("rejects workspaceDir outside workspace base", async () => {
    const integrations: IntegrationWithCredentials[] = [
      {
        id: "conn-1",
        name: "render",
        type: "render",
        enabled: true,
        config: {},
        credentials: { apiKey: "test" },
      },
    ]

    await expect(
      injectSpecFiles("/tmp/malicious-dir", integrations),
    ).rejects.toThrow("workspaceDir must be within the workspace base directory")
    expect(cp).not.toHaveBeenCalled()
  })
})
