import { describe, it, expect } from "vitest"
import { ToolMessage, AIMessage, HumanMessage } from "@langchain/core/messages"
import { extractGatheredData } from "../../agents/gatherer/index.js"
import type { GatheredData } from "../../types/state.js"

function makeToolMessage(name: string, content: string | Record<string, unknown>) {
  return new ToolMessage({
    content: typeof content === "string" ? content : JSON.stringify(content),
    name,
    tool_call_id: `call_${name}_${Date.now()}`,
  })
}

describe("extractGatheredData", () => {
  it("returns existingData unchanged for empty messages", () => {
    const existing: GatheredData = { logs: [{ entry: "old" }] }
    const result = extractGatheredData([], existing)

    expect(result).toEqual(existing)
    expect(result).not.toBe(existing) // new object, not mutation
  })

  it("extracts search_logs to logs field", () => {
    const messages = [
      makeToolMessage("search_logs", { logs: [{ line: "error occurred" }] }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.logs).toEqual([{ line: "error occurred" }])
  })

  it("extracts analyze_log_patterns to logs field", () => {
    const messages = [
      makeToolMessage("analyze_log_patterns", {
        patterns: [{ pattern: "spike at 2pm" }],
      }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.logs).toEqual([{ pattern: "spike at 2pm" }])
  })

  it("extracts search_code to codeSearchResults field", () => {
    const messages = [
      makeToolMessage("search_code", { results: [{ file: "app.ts", line: 42 }] }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.codeSearchResults).toEqual([{ file: "app.ts", line: 42 }])
  })

  it("extracts get_file_content to codeSearchResults field (singular value)", () => {
    const messages = [
      makeToolMessage("get_file_content", { content: "file contents here" }),
    ]
    const result = extractGatheredData(messages, {})

    // content is not an array, so it gets wrapped in one
    expect(result.codeSearchResults).toEqual(["file contents here"])
  })

  it("extracts get_recent_commits to commits field", () => {
    const messages = [
      makeToolMessage("get_recent_commits", {
        commits: [{ sha: "abc123", message: "fix bug" }],
      }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.commits).toEqual([{ sha: "abc123", message: "fix bug" }])
  })

  it("extracts get_deployment_history to deployments field", () => {
    const messages = [
      makeToolMessage("get_deployment_history", {
        deployments: [{ id: "d1", version: "1.2.3" }],
      }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.deployments).toEqual([{ id: "d1", version: "1.2.3" }])
  })

  it("extracts search_similar_resolutions to similarIncidents field", () => {
    const messages = [
      makeToolMessage("search_similar_resolutions", {
        resolutions: [{ title: "similar bug", resolution: "rollback" }],
      }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.similarIncidents).toEqual([
      { title: "similar bug", resolution: "rollback" },
    ])
  })

  it("extracts lookup_runbook to similarIncidents field", () => {
    const messages = [
      makeToolMessage("lookup_runbook", {
        runbook: { title: "DB recovery", steps: ["restart", "verify"] },
      }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.similarIncidents).toEqual([
      { title: "DB recovery", steps: ["restart", "verify"] },
    ])
  })

  it("skips lookup_runbook when runbook value is null", () => {
    const messages = [
      makeToolMessage("lookup_runbook", { runbook: null }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.similarIncidents).toBeUndefined()
  })

  it("merges multiple tool messages additively", () => {
    const messages = [
      makeToolMessage("search_logs", { logs: [{ line: "error 1" }] }),
      makeToolMessage("search_logs", { logs: [{ line: "error 2" }] }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.logs).toEqual([{ line: "error 1" }, { line: "error 2" }])
  })

  it("merges with existing data (append, not replace)", () => {
    const existing: GatheredData = { logs: [{ line: "old log" }] }
    const messages = [
      makeToolMessage("search_logs", { logs: [{ line: "new log" }] }),
    ]
    const result = extractGatheredData(messages, existing)

    expect(result.logs).toEqual([{ line: "old log" }, { line: "new log" }])
  })

  it("skips malformed JSON gracefully", () => {
    const msg = new ToolMessage({
      content: "not valid json {{{",
      name: "search_logs",
      tool_call_id: "call_1",
    })
    const result = extractGatheredData([msg], {})

    expect(result.logs).toBeUndefined()
  })

  it("skips non-tool messages (AIMessage, HumanMessage)", () => {
    const messages = [
      new AIMessage("I'll search for logs now"),
      new HumanMessage("please do"),
      makeToolMessage("search_logs", { logs: [{ line: "found it" }] }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.logs).toEqual([{ line: "found it" }])
  })

  it("skips unknown tool messages (no data mapping)", () => {
    const messages = [
      makeToolMessage("unknown_tool", { data: [] }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.logs).toBeUndefined()
    expect(result.commits).toBeUndefined()
  })

  it("skips when expected data key is missing from parsed content", () => {
    const messages = [
      makeToolMessage("search_logs", { message: "no logs key here" }),
    ]
    const result = extractGatheredData(messages, {})

    expect(result.logs).toBeUndefined()
  })

  it("handles pre-parsed object content (not string)", () => {
    const msg = new ToolMessage({
      content: JSON.stringify({ commits: [{ sha: "def456" }] }),
      name: "get_recent_commits",
      tool_call_id: "call_1",
    })
    const result = extractGatheredData([msg], {})

    expect(result.commits).toEqual([{ sha: "def456" }])
  })
})
