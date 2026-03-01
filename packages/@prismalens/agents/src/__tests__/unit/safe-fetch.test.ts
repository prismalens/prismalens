import { describe, it, expect } from "vitest"
import { safeFetch } from "../../utils/safe-fetch.js"

describe("safeFetch", () => {
  it("returns data and success on resolved promise", async () => {
    const result = await safeFetch(() => Promise.resolve(42), 0, "test")
    expect(result).toEqual({ data: 42, success: true })
  })

  it("returns fallback and error on Error throw", async () => {
    const result = await safeFetch(
      () => Promise.reject(new Error("boom")),
      "default",
      "myLabel",
    )
    expect(result).toEqual({
      data: "default",
      success: false,
      error: "myLabel: boom",
    })
  })

  it("returns complex objects as data", async () => {
    const obj = { alerts: [{ id: "a1" }], hasMore: false }
    const result = await safeFetch(() => Promise.resolve(obj), { alerts: [], hasMore: false }, "alerts")
    expect(result.data).toBe(obj)
    expect(result.success).toBe(true)
  })
})
