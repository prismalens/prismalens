// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { legacySettingsTarget, validateSettingsSearch } from "./route";

// The router merges `{ ...raw, ...validated }`; the merge is what Settings reads.
const merged = (raw: Record<string, unknown>) => ({
	...raw,
	...validateSettingsSearch(raw),
});

describe("Settings tab search (w8-2)", () => {
	it("drops an unknown tab so Settings falls back to the default", () => {
		expect(merged({ tab: "nope" }).tab).toBeUndefined();
		expect(merged({ tab: 3 }).tab).toBeUndefined();
	});

	it("keeps a known tab", () => {
		expect(merged({ tab: "notifications" }).tab).toBe("notifications");
	});

	it("sends a tab from before #848 to its new page", () => {
		expect(legacySettingsTarget("?tab=integrations")).toEqual({
			tab: "notifications",
		});
		expect(legacySettingsTarget("?tab=danger")).toEqual({
			tab: "about",
			hash: "danger-zone",
		});
	});
});
