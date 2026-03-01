import { describe, it, expect } from "vitest"
import { createCheckpointer } from "../../utils/checkpointer-factory.js"

describe("createCheckpointer", () => {
  it("should create a SqliteSaver for sqlite dbType", async () => {
    const saver = await createCheckpointer({
      dbType: "sqlite",
      connectionString: ":memory:",
    })

    expect(saver).toBeDefined()
    expect(saver.getTuple).toBeDefined()
    expect(saver.list).toBeDefined()
    expect(saver.put).toBeDefined()

    // Verify it works: store and retrieve a checkpoint
    const config = { configurable: { thread_id: "factory-test", checkpoint_ns: "" } }
    const checkpoint = {
      v: 4,
      ts: "2025-01-01T00:00:00.000Z",
      id: "factory-cp",
      channel_values: { test: true },
      channel_versions: { __start__: 1 },
      versions_seen: {},
    }
    await saver.put(config, checkpoint, {}, {})

    const tuple = await saver.getTuple(config)
    expect(tuple).toBeDefined()
    expect(tuple!.checkpoint.channel_values).toEqual({ test: true })
  })

})
