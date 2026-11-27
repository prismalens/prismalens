// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { ApproveSharedServerInputSchema } from "./agent-setup.js";
import { heldSharedRevision } from "./agent-setup-values.js";

const opened = (how: string, revision?: string, harness?: string) => ({
	kind: "session_opened",
	how,
	...(harness ? { harness } : {}),
	...(revision !== undefined ? { sharedSet: { revision } } : {}),
});

describe("ApproveSharedServerInputSchema (#1180 §3.3)", () => {
	it("refuses a copied-from entry with an empty key, which no view can point at", () => {
		const input = (key: string) => ({
			name: "docs",
			def: { type: "http", url: "https://mcp.example/v1", query: [], headers: [] },
			values: {},
			recipients: ["codex"],
			from: { agent: "codex", path: "~/.codex/config.toml", key, revision: "r" },
		});
		expect([
			ApproveSharedServerInputSchema.safeParse(input("")).error?.issues.map((i) => [i.path.join("."), i.code]),
			ApproveSharedServerInputSchema.safeParse(input("docs")).success,
		]).toEqual([[["from.key", "too_small"]], true]);
	});
});

describe("heldSharedRevision (#1180 §3.3)", () => {
	it("is null before any session opens", () => {
		expect(heldSharedRevision([{ kind: "message" }])).toBeNull();
	});

	it("is the revision the last opening recorded", () => {
		expect(heldSharedRevision([opened("new", "r1"), opened("resume", "r1"), opened("handoff", "r2")])).toBe("r2");
	});

	it("keeps the revision held before a reopen that recorded none, and is empty after a fresh one that recorded none", () => {
		expect(heldSharedRevision([opened("new", "r1"), opened("load")])).toBe("r1");
		expect(heldSharedRevision([opened("new", "r1"), opened("summary")])).toBe("");
		expect(heldSharedRevision([opened("resume")])).toBe("");
	});

	it("takes up the revision a completed compaction recorded, and ignores a started or failed one", () => {
		const base = [opened("new", "r1"), opened("resume", "r1")];
		expect(heldSharedRevision([...base, { kind: "compaction", phase: "started", sharedRevision: "r2" }])).toBe("r1");
		expect(heldSharedRevision([...base, { kind: "compaction", phase: "failed", sharedRevision: "r2" }])).toBe("r1");
		expect(heldSharedRevision([...base, { kind: "compaction", phase: "completed", sharedRevision: "r2" }])).toBe("r2");
		expect(heldSharedRevision([...base, { kind: "compaction", phase: "completed" }])).toBe("r1");
	});

	it("takes up the revision a turn's receipt recorded, and keeps the held one past a receipt that recorded none", () => {
		const base = [opened("new", "")];
		expect([
			heldSharedRevision([...base, { kind: "message_received", sharedRevision: "r2" }]),
			heldSharedRevision([...base, { kind: "message_received", sharedRevision: "r2" }, { kind: "message_received" }]),
		]).toEqual(["r2", "r2"]);
	});

	it("given an agent, reads only that agent's own sessions, with the compactions and receipts inside them", () => {
		// OpenCode took r1; Claude Code was handed r2 and compacted to r3; the thread returns to OpenCode.
		const thread = [
			opened("new", "", "opencode"),
			{ kind: "message_received", sharedRevision: "r1" },
			opened("handoff", "r2", "claude-code"),
			{ kind: "compaction", phase: "completed", sharedRevision: "r3" },
			{ kind: "message_received", sharedRevision: "r3" },
			opened("return", undefined, "opencode"),
		];
		expect([
			heldSharedRevision(thread, "opencode"),
			heldSharedRevision(thread.slice(0, 5), "claude-code"),
			heldSharedRevision(thread, "gemini"),
			heldSharedRevision(thread.slice(0, 5)),
		]).toEqual(["r1", "r3", null, "r3"]);
	});
});
