// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { validateSettingsSearch } from "./route";

// The router merges `{ ...raw, ...validated }`; the merge is what Settings reads.
const merged = (raw: Record<string, unknown>) => ({
	...raw,
	...validateSettingsSearch(raw),
});

describe("Settings tab search (w8-2)", () => {
	it("drops an unknown tab so Settings falls back to the default", () => {
		expect(merged({ tab: "agent" }).tab).toBeUndefined();
		expect(merged({ tab: "nope" }).tab).toBeUndefined();
		expect(merged({ tab: 3 }).tab).toBeUndefined();
	});

	it("keeps a known tab", () => {
		expect(merged({ tab: "integrations" }).tab).toBe("integrations");
	});
});

describe("Settings agent page search (#907)", () => {
	it("keeps a known agent only under the Agent tab", () => {
		expect(merged({ tab: "harness", agent: "codex" }).agent).toBe("codex");
		expect(merged({ tab: "harness", agent: "local" }).agent).toBe("local");
		expect(merged({ tab: "devices", agent: "codex" }).agent).toBeUndefined();
		expect(merged({ agent: "codex" }).agent).toBeUndefined();
		expect(merged({ tab: "harness", agent: "nope" }).agent).toBeUndefined();
	});
});
