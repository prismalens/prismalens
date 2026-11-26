// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { heldSharedRevision } from "./agent-setup-values.js";

const opened = (how: string, revision?: string) => ({
	kind: "session_opened",
	how,
	...(revision !== undefined ? { sharedSet: { revision } } : {}),
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
});
