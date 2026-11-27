// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { sharedOf } from "./investigation-run.js";
import type { RunPorts } from "./run-ports.js";

const set = {
	servers: [],
	hidden: [],
	revision: "r2",
	instructions: "Always cite the runbook.",
	fingerprint: "fp",
	profile: "own" as const,
};

describe("sharedOf (#1180 §3.3)", () => {
	it("gives a follow-up the revision its own agent's session holds, not the last one the thread recorded", async () => {
		// OpenCode took r1; the set moved to r2 and a Claude Code handoff recorded it; the thread returns to OpenCode.
		const thread = [
			{ kind: "session_opened", how: "new", harness: "opencode", sharedSet: { revision: "", servers: [] } },
			{ kind: "message_received", messageIds: [], sharedRevision: "r1" },
			{ kind: "session_opened", how: "handoff", harness: "claude-code", sharedSet: { revision: "r2", servers: [] } },
		] as unknown as CanonicalEvent[];
		const ports = { sharedSet: async () => set, events: async () => thread } as unknown as RunPorts;
		const held = async (harness: "opencode" | "claude-code") =>
			(await sharedOf(ports, harness, "/ws", "thread-1"))?.held;
		expect([await held("opencode"), await held("claude-code")]).toEqual(["r1", "r2"]);
	});
});
