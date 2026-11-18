// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { sessionOpening } from "./handoff.js";

const seed = { from: "claude-code", carried: "the report" };

describe("sessionOpening (#1166)", () => {
	it("follows reopenPath's precedence", () => {
		expect(
			sessionOpening({ reopen: "fresh", replayed: 0, fresh: seed, seed: { by: "handoff", ...seed } }),
		).toEqual({ how: "load_broken", from: "claude-code", carried: "the report" });
		expect(sessionOpening({ reopen: "resume", replayed: 0 })).toEqual({ how: "resume" });
		expect(sessionOpening({ reopen: "load-marker", replayed: 3 })).toEqual({
			how: "load",
			replay: "marker",
			replayed: 3,
		});
		expect(sessionOpening({ reopen: "load-dedupe", replayed: 2, modelFrom: "sonnet" })).toEqual({
			how: "load",
			replay: "dedupe",
			replayed: 2,
			modelFrom: "sonnet",
		});
		expect(sessionOpening({ reopen: null, replayed: 0, seed: { by: "summary", ...seed } })).toEqual({
			how: "summary",
		});
		expect(sessionOpening({ reopen: null, replayed: 0, seed: { by: "handoff", ...seed } })).toEqual({
			how: "handoff",
			from: "claude-code",
			carried: "the report",
		});
		expect(sessionOpening({ reopen: null, replayed: 0 })).toEqual({ how: "new" });
	});

	it("keeps modelFrom only on a reopen", () => {
		expect(sessionOpening({ reopen: null, replayed: 0, modelFrom: "sonnet" })).toEqual({ how: "new" });
		expect(sessionOpening({ reopen: "resume", replayed: 0, modelFrom: "sonnet" })).toEqual({
			how: "resume",
			modelFrom: "sonnet",
		});
	});
});
