// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { markLook, reachOf } from "./marks";

describe("an ask's reach, from its ACP tool kind", () => {
	it.each([
		["read", "read", "Reads files", "text-text-3"],
		["search", "read", "Reads files", "text-text-3"],
		["edit", "write", "Edits files", "text-text-3"],
		["move", "write", "Edits files", "text-text-3"],
		["delete", "delete", "Deletes files", "text-danger"],
		["execute", "run", "Runs a command", "text-warn"],
		["fetch", "network", "Reaches the network", "text-warn"],
		["think", "other", "Other action", "text-text-3"],
	])("%s reaches %s (%s), tinted %s", (kind, state, word, tone) => {
		const r = reachOf(kind);
		expect(r).toEqual({ state, word });
		expect(markLook("reach", r.state).className).toBe(tone);
	});
});
