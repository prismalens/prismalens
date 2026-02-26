import { describe, it, expect } from "vitest"
import { scoreHypothesis } from "../../agents/analyst/extract.js"

describe("scoreHypothesis", () => {
  it("returns base confidence with no evidence", () => {
    expect(scoreHypothesis(0.5, [])).toBe(0.5)
  })

  it("increases confidence with supporting inferred evidence", () => {
    const result = scoreHypothesis(0.4, [
      { direction: "supporting", strength: "strong", verified: false },
      { direction: "supporting", strength: "moderate", verified: false },
    ])
    expect(result).toBeGreaterThan(0.4)
    expect(result).toBeLessThanOrEqual(1)
  })

  it("weights verified evidence higher than inferred", () => {
    const inferred = scoreHypothesis(0.3, [
      { direction: "supporting", strength: "strong", verified: false },
    ])
    const verified = scoreHypothesis(0.3, [
      { direction: "supporting", strength: "strong", verified: true },
    ])
    expect(verified).toBeGreaterThan(inferred)
  })

  it("decreases confidence with contradicting evidence", () => {
    const result = scoreHypothesis(0.6, [
      { direction: "contradicting", strength: "strong", verified: false },
    ])
    expect(result).toBeLessThan(0.6)
  })

  it("applies heavier penalty for verified contradicting evidence", () => {
    const inferred = scoreHypothesis(0.6, [
      { direction: "contradicting", strength: "strong", verified: false },
    ])
    const verified = scoreHypothesis(0.6, [
      { direction: "contradicting", strength: "strong", verified: true },
    ])
    expect(verified).toBeLessThan(inferred)
  })

  it("clamps result to [0, 1]", () => {
    // Extreme positive
    const high = scoreHypothesis(0.9, [
      { direction: "supporting", strength: "strong", verified: true },
      { direction: "supporting", strength: "strong", verified: true },
      { direction: "supporting", strength: "strong", verified: true },
    ])
    expect(high).toBeLessThanOrEqual(1)

    // Extreme negative
    const low = scoreHypothesis(0.1, [
      { direction: "contradicting", strength: "strong", verified: true },
      { direction: "contradicting", strength: "strong", verified: true },
      { direction: "contradicting", strength: "strong", verified: true },
    ])
    expect(low).toBeGreaterThanOrEqual(0)
  })

  it("handles mixed supporting and contradicting evidence", () => {
    const result = scoreHypothesis(0.5, [
      { direction: "supporting", strength: "strong", verified: false },
      { direction: "contradicting", strength: "weak", verified: false },
    ])
    // Net positive (strong supporting > weak contradicting)
    expect(result).toBeGreaterThan(0.5)
  })

  it("handles all strength levels for inferred supporting", () => {
    const strong = scoreHypothesis(0.3, [
      { direction: "supporting", strength: "strong", verified: false },
    ])
    const moderate = scoreHypothesis(0.3, [
      { direction: "supporting", strength: "moderate", verified: false },
    ])
    const weak = scoreHypothesis(0.3, [
      { direction: "supporting", strength: "weak", verified: false },
    ])
    expect(strong).toBeGreaterThan(moderate)
    expect(moderate).toBeGreaterThan(weak)
    expect(weak).toBeGreaterThan(0.3)
  })
})
