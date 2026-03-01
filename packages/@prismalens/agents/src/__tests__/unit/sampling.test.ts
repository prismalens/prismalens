import { describe, it, expect } from "vitest"
import { sampleAlerts } from "../../agents/scout/sampling.js"
import type { AlertContext } from "../../types/contexts.js"

function makeAlert(severity: string, id: string): AlertContext {
  return {
    alertId: id,
    title: `Alert ${id}`,
    severity: severity as AlertContext["severity"],
    status: "triggered",
    triggeredAt: new Date().toISOString(),
  }
}

describe("sampleAlerts", () => {
  it("returns all alerts when within limit", () => {
    const alerts = [makeAlert("medium", "1"), makeAlert("low", "2")]
    expect(sampleAlerts(alerts, 10)).toBe(alerts)
  })

  it("returns same reference when exactly at limit", () => {
    const alerts = [makeAlert("medium", "1"), makeAlert("low", "2")]
    expect(sampleAlerts(alerts, 2)).toBe(alerts)
  })

  it("prioritizes critical and high alerts", () => {
    const alerts = [
      makeAlert("low", "1"),
      makeAlert("critical", "2"),
      makeAlert("medium", "3"),
      makeAlert("high", "4"),
      makeAlert("info", "5"),
    ]
    const result = sampleAlerts(alerts, 3)
    expect(result).toHaveLength(3)
    // Should include critical and high
    const ids = result.map((a) => a.alertId)
    expect(ids).toContain("2") // critical
    expect(ids).toContain("4") // high
  })

  it("fills remaining budget from non-priority alerts", () => {
    const alerts = [
      makeAlert("critical", "c1"),
      makeAlert("low", "l1"),
      makeAlert("low", "l2"),
      makeAlert("medium", "m1"),
    ]
    const result = sampleAlerts(alerts, 3)
    expect(result).toHaveLength(3)
    expect(result[0].alertId).toBe("c1")
    // Rest filled from non-priority
    expect(result[1].alertId).toBe("l1")
    expect(result[2].alertId).toBe("l2")
  })

  it("truncates priority alerts when they exceed limit", () => {
    const alerts = [
      makeAlert("critical", "c1"),
      makeAlert("critical", "c2"),
      makeAlert("high", "h1"),
      makeAlert("high", "h2"),
    ]
    const result = sampleAlerts(alerts, 2)
    expect(result).toHaveLength(2)
    expect(result[0].alertId).toBe("c1")
    expect(result[1].alertId).toBe("c2")
  })

  it("handles empty alerts", () => {
    expect(sampleAlerts([], 10)).toEqual([])
  })
})
