import { describe, it, expect } from "vitest"
import { MemorySaver } from "@langchain/langgraph-checkpoint"
import {
  getCheckpoint,
  listCheckpoints,
  getStateFromCheckpoint,
  getCheckpointTimestamp,
  getBestHypothesis,
} from "./checkpoints.js"

describe("checkpoints", () => {
  describe("getCheckpoint", () => {
    it("should return null for non-existent thread", async () => {
      const saver = new MemorySaver()
      const result = await getCheckpoint(saver, "non-existent-thread")
      expect(result).toBeNull()
    })

    it("should return checkpoint tuple for existing thread", async () => {
      const saver = new MemorySaver()
      const config = { configurable: { thread_id: "test-thread", checkpoint_ns: "" } }

      // Store a checkpoint
      const checkpoint = {
        v: 4,
        ts: "2025-01-01T00:00:00.000Z",
        id: "test-checkpoint-id",
        channel_values: { myKey: "hello" },
        channel_versions: { __start__: 1 },
        versions_seen: {},
      }
      await saver.put(config, checkpoint, {}, {})

      const result = await getCheckpoint(saver, "test-thread")
      expect(result).not.toBeNull()
      expect(result!.checkpoint.channel_values).toEqual({ myKey: "hello" })
    })
  })

  describe("listCheckpoints", () => {
    it("should return empty array for non-existent thread", async () => {
      const saver = new MemorySaver()
      const result = await listCheckpoints(saver, "non-existent-thread")
      expect(result).toEqual([])
    })

    it("should return all checkpoints for a thread", async () => {
      const saver = new MemorySaver()
      const config = { configurable: { thread_id: "test-thread", checkpoint_ns: "" } }

      // Store two checkpoints
      const cp1 = {
        v: 4,
        ts: "2025-01-01T00:00:00.000Z",
        id: "cp-1",
        channel_values: { step: 1 },
        channel_versions: { __start__: 1 },
        versions_seen: {},
      }
      await saver.put(config, cp1, {}, {})

      const cp2 = {
        v: 4,
        ts: "2025-01-01T00:01:00.000Z",
        id: "cp-2",
        channel_values: { step: 2 },
        channel_versions: { __start__: 2 },
        versions_seen: {},
      }
      await saver.put(config, cp2, {}, {})

      const result = await listCheckpoints(saver, "test-thread")
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("getStateFromCheckpoint", () => {
    it("should return null for null input", () => {
      expect(getStateFromCheckpoint(null)).toBeNull()
    })

    it("should extract channel_values from a checkpoint tuple", async () => {
      const saver = new MemorySaver()
      const config = { configurable: { thread_id: "state-thread", checkpoint_ns: "" } }

      const checkpoint = {
        v: 4,
        ts: "2025-01-01T00:00:00.000Z",
        id: "state-cp",
        channel_values: { investigationId: "inv-123", hypotheses: [] },
        channel_versions: { __start__: 1 },
        versions_seen: {},
      }
      await saver.put(config, checkpoint, {}, {})

      const tuple = await getCheckpoint(saver, "state-thread")
      const state = getStateFromCheckpoint<{ investigationId: string }>(tuple)
      expect(state).not.toBeNull()
      expect(state!.investigationId).toBe("inv-123")
    })
  })

  describe("getCheckpointTimestamp", () => {
    it("should return null for null input", () => {
      expect(getCheckpointTimestamp(null)).toBeNull()
    })

    it("should extract timestamp from checkpoint tuple", async () => {
      const saver = new MemorySaver()
      const config = { configurable: { thread_id: "ts-thread", checkpoint_ns: "" } }

      const checkpoint = {
        v: 4,
        ts: "2025-06-15T12:34:56.000Z",
        id: "ts-cp",
        channel_values: {},
        channel_versions: { __start__: 1 },
        versions_seen: {},
      }
      await saver.put(config, checkpoint, {}, {})

      const tuple = await getCheckpoint(saver, "ts-thread")
      const ts = getCheckpointTimestamp(tuple)
      expect(ts).toBeDefined()
      // The stored timestamp may be replaced by MemorySaver, just check it's a string
      expect(typeof ts).toBe("string")
    })
  })

  describe("getBestHypothesis", () => {
    it("should return null for empty array", () => {
      expect(getBestHypothesis([])).toBeNull()
    })

    it("should return null for non-array input", () => {
      expect(getBestHypothesis(null)).toBeNull()
      expect(getBestHypothesis(undefined)).toBeNull()
      expect(getBestHypothesis("string")).toBeNull()
    })

    it("should return the hypothesis with highest confidence", () => {
      const hypotheses = [
        { id: "h1", title: "Low", confidence: 30, description: "", category: "configuration", evidence: [] },
        { id: "h2", title: "High", confidence: 85, description: "", category: "configuration", evidence: [] },
        { id: "h3", title: "Mid", confidence: 60, description: "", category: "configuration", evidence: [] },
      ]
      const best = getBestHypothesis(hypotheses)
      expect(best).not.toBeNull()
      expect(best!.id).toBe("h2")
      expect(best!.confidence).toBe(85)
    })

    it("should accept object with hypotheses property", () => {
      const state = {
        hypotheses: [
          { id: "h1", title: "Only", confidence: 70, description: "", category: "configuration", evidence: [] },
        ],
      }
      const best = getBestHypothesis(state)
      expect(best).not.toBeNull()
      expect(best!.id).toBe("h1")
    })
  })
})
